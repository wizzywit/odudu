import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { outboxRepository, renderVerifyEmail } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';

// Keycloak's action-token defaults (`actionTokenGeneratedByUserLifespan` and
// its per-action override for email verification): 12 hours for a link the
// user follows from their own inbox at their own pace, 5 minutes for one
// that grants password reset — an account-takeover window that stays short
// on purpose. RESET_PASSWORD_TTL_SECONDS is defined here, next to the
// constant it mirrors, for the password-reset task to import rather than
// invent independently.
export const VERIFY_EMAIL_TTL_SECONDS = 60 * 60 * 12;
export const RESET_PASSWORD_TTL_SECONDS = 60 * 5;

export interface SendVerificationEmailDeps {
  readonly database: DatabaseHandle;
  readonly realmId: string;
  readonly realmName: string;
  readonly realmDisplayName: string;
  readonly issuerBase: string;
}

export interface SendVerificationEmailInput {
  readonly subjectId: string;
  readonly email: string;
}

// The token and the mail that carries it are written in one transaction:
// a token the user could receive but the database never durably stored
// would be a support call with no trace, and a queued message naming a
// token that rolled back would be a link that refuses on arrival. Nothing
// here talks to a mail server — the sender does that on its own schedule
// (packages/email/src/usecase/send-pending.ts), which is what keeps an
// SMTP round trip out of the response.
export async function sendVerificationEmail(
  deps: SendVerificationEmailDeps,
  input: SendVerificationEmailInput,
): Promise<void> {
  await withRealm(deps.database.db, deps.realmId, async (tx) => {
    const { token } = await actionTokenRepository(tx).issue({
      realmId: deps.realmId,
      subjectId: input.subjectId,
      type: 'verify_email',
      email: input.email,
      ttlSeconds: VERIFY_EMAIL_TTL_SECONDS,
    });
    const link = `${deps.issuerBase}/realms/${deps.realmName}/login-actions/action-token?key=${encodeURIComponent(token)}`;
    await outboxRepository(tx).enqueue({
      realmId: deps.realmId,
      ...renderVerifyEmail({ to: input.email, link, realmDisplayName: deps.realmDisplayName }),
    });
  });
}

export interface CompleteEmailVerificationDeps {
  readonly database: DatabaseHandle;
  readonly realmId: string;
  // Injected rather than imported: @odudu/account does not depend on
  // @odudu/domain-identity, where the users table and its Argon2id
  // neighbours live. The composition root (apps/server/src/app.ts) wires
  // these to userRepository, the same way domain-realm's verifyClientSecret
  // takes its hash comparator injected for the same reason.
  readonly getCurrentEmail: (tx: RealmScopedDatabase, subjectId: string) => Promise<string | null>;
  readonly markVerified: (tx: RealmScopedDatabase, subjectId: string) => Promise<void>;
}

export type CompleteEmailVerificationResult = { kind: 'verified' } | { kind: 'invalid' };

// One transaction: consuming the token, reading the address it was minted
// for back against the user's current one, and flipping emailVerified all
// commit or roll back together. `withRealm`'s RLS context is what refuses a
// token minted in another realm — consume finds no row to update, the same
// path a replayed or expired key takes.
export async function completeEmailVerification(
  deps: CompleteEmailVerificationDeps,
  key: string,
): Promise<CompleteEmailVerificationResult> {
  return withRealm(deps.database.db, deps.realmId, async (tx) => {
    const record = await actionTokenRepository(tx).consume(key, 'verify_email');
    if (record === null) return { kind: 'invalid' };

    // The token carries the address it was minted for; a changed address
    // since then means this link no longer proves anything about the
    // address the user holds today.
    const currentEmail = await deps.getCurrentEmail(tx, record.subjectId);
    if (currentEmail === null || currentEmail !== record.email) return { kind: 'invalid' };

    await deps.markVerified(tx, record.subjectId);
    return { kind: 'verified' };
  });
}
