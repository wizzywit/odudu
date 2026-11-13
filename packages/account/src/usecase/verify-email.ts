import { actionLink } from '#/service/action-link';
import { mayTakeAddress } from '#/service/address-change';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import {
  mailContext,
  outboxRepository,
  renderVerifyEmail,
  type MailLookResolver,
  type MailContext,
} from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type ReturnTarget } from '#/schema/action-tokens';
import { mailAddressOf } from '#/usecase/mail-address';
import { type LookupCanonicalDomain } from '@odudu/domain-tenant';

export interface SendVerificationEmailDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  readonly issuerBase: string;
  readonly lookupDomain?: LookupCanonicalDomain | undefined;
  // The send time of the mail, from the caller's clock.
  readonly now: () => Date;
  // Themes the mail the way the tenant's pages are; absent, it is unthemed.
  readonly resolveMailLook?: MailLookResolver | undefined;
}

export interface SendVerificationEmailInput {
  readonly subjectId: string;
  readonly email: string;
  readonly locale?: string | null | undefined;
  // The client an administrator's link returns to; a self-service link has none.
  readonly returnTo?: ReturnTarget | undefined;
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
  await withTenant(deps.database.db, deps.tenantId, (tx) =>
    enqueueVerificationLink(tx, deps, input),
  );
}

/** `sendVerificationEmail`'s write, in the caller's transaction, for an administrator's resend. */
export async function enqueueVerificationLink(
  tx: TenantScopedDatabase,
  tenant: Omit<SendVerificationEmailDeps, 'database'>,
  input: SendVerificationEmailInput,
  context?: MailContext,
): Promise<void> {
  const address = await mailAddressOf(tx, tenant);
  const mail = context ?? (await mailContext(tx, tenant.resolveMailLook, { ...tenant, address }));
  const tokens = actionTokenRepository(tx);
  const { token } = await tokens.issue({
    tenantId: tenant.tenantId,
    subjectId: input.subjectId,
    type: 'verify_email',
    email: input.email,
    returnTo: input.returnTo,
    ttlSeconds: await tokens.lifetimeOf(tenant.tenantId, 'verify_email'),
  });
  const link = actionLink(address, token);
  await outboxRepository(tx).enqueue({
    tenantId: tenant.tenantId,
    ...renderVerifyEmail({
      to: input.email,
      link,
      tenantDisplayName: tenant.tenantDisplayName,
      now: tenant.now(),
      locale: input.locale,
      ...mail,
    }),
  });
}

// What swapping a proved address in needs of the identity tables, injected for
// the same reason getCurrentEmail and markVerified are.
export interface ChangeAddressDeps {
  // Serialises completions and creations for one address.
  readonly lockAddress: (
    tx: TenantScopedDatabase,
    tenantId: string,
    email: string,
  ) => Promise<void>;
  // Deletes the subject's pending address when it is `email`, and says whether it was.
  readonly takePending: (
    tx: TenantScopedDatabase,
    subjectId: string,
    email: string,
  ) => Promise<boolean>;
  // The subject that holds the address in the tenant, in any case.
  readonly holderOf: (tx: TenantScopedDatabase, email: string) => Promise<string | null>;
  readonly replaceVerified: (
    tx: TenantScopedDatabase,
    subjectId: string,
    email: string,
  ) => Promise<void>;
}

export interface CompleteEmailVerificationDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
  readonly request: RequestContext;
  // Injected rather than imported: @odudu/account does not depend on
  // @odudu/domain-identity, where the users table and its Argon2id
  // neighbours live. The composition root (apps/server/src/app.ts) wires
  // these to userRepository, the same way domain-tenant's verifyClientSecret
  // takes its hash comparator injected for the same reason.
  readonly getCurrentEmail: (tx: TenantScopedDatabase, subjectId: string) => Promise<string | null>;
  readonly markVerified: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
  // Absent, a link for an address other than the current one is refused.
  readonly changeAddress?: ChangeAddressDeps | undefined;
}

export type CompleteEmailVerificationResult = { kind: 'verified' } | { kind: 'invalid' };

// One transaction: consuming the token, reading the address it was minted
// for back against the user's current one, and flipping emailVerified all
// commit or roll back together. `withTenant`'s RLS context is what refuses a
// token minted in another tenant — consume finds no row to update, the same
// path a replayed or expired key takes.
export async function completeEmailVerification(
  deps: CompleteEmailVerificationDeps,
  key: string,
): Promise<CompleteEmailVerificationResult> {
  return withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx) => {
      const record = await actionTokenRepository(tx).consume(key, 'verify_email');
      if (record === null) return { kind: 'invalid' };

      // The token carries the address it was minted for. When it is not the
      // one the user holds today, it is a link for an address they asked to
      // change to, or one that no longer proves anything.
      const currentEmail = await deps.getCurrentEmail(tx, record.subjectId);
      if (currentEmail === null || currentEmail !== record.email) {
        return deps.changeAddress === undefined || record.email === null
          ? { kind: 'invalid' }
          : swapAddress(tx, deps.changeAddress, deps, record.subjectId, record.email);
      }

      await deps.markVerified(tx, record.subjectId);
      await auditRepository(tx).record({
        eventType: 'credential',
        action: 'email.verified',
        outcome: 'allowed',
        actorSubjectId: record.subjectId,
        resourceType: 'subject',
        resourceId: record.subjectId,
      });
      return { kind: 'verified' };
    },
    deps.request,
  );
}

// The pending address is taken first, so a request replaced or cleared since
// the link was mailed finds nothing, and the address is looked at under its
// lock, so two accounts cannot both be given it.
async function swapAddress(
  tx: TenantScopedDatabase,
  change: ChangeAddressDeps,
  deps: CompleteEmailVerificationDeps,
  subjectId: string,
  email: string,
): Promise<CompleteEmailVerificationResult> {
  await change.lockAddress(tx, deps.tenantId, email);
  if (!(await change.takePending(tx, subjectId, email))) return { kind: 'invalid' };
  if (!mayTakeAddress(await change.holderOf(tx, email), subjectId)) return { kind: 'invalid' };
  await change.replaceVerified(tx, subjectId, email);
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'email.changed',
    outcome: 'allowed',
    actorSubjectId: subjectId,
    resourceType: 'subject',
    resourceId: subjectId,
  });
  return { kind: 'verified' };
}
