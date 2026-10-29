import { actionLink } from '#/service/action-link';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import {
  mailContext,
  outboxRepository,
  renderResetPassword,
  type MailLookResolver,
  type MailContext,
} from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/tenant-settings';
import { type MailGate } from '#/service/mail-gate';
import { withMinimum } from '#/service/password-violations';

// Re-exported so the view layer can reach these without importing the
// repository directly (no-view-to-repository, .dependency-cruiser.cjs):
// view → usecase is permitted, usecase → repository is where the type
// actually lives.
export type { PasswordPolicy, PolicyViolation };

export interface RequestPasswordResetDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  // Never derived from the request that reached this usecase: see
  // #/view/routes/registration.ts for why a request header cannot be
  // trusted with the contents of a mail sent to a third party.
  readonly issuerBase: string | undefined;
  // The send time of the mail, from the caller's clock.
  readonly now: () => Date;
  // Themes the mail the way the tenant's pages are; absent, it is unthemed.
  readonly resolveMailLook?: MailLookResolver | undefined;
  // The sign-in the person asked from, when this browser holds it
  // (referenceToResume): kept beside the token, never in the mailed link.
  readonly authenticationSessionId?: string | null;
  // The client that sign-in was made for, so the mail wears its look; from the
  // held sign-in only (clientOfHeldSignIn), never from the request.
  readonly clientId?: string | null;
  // Injected for the reason completePasswordReset's setPassword is:
  // @odudu/account depends on neither @odudu/domain-identity nor
  // @odudu/domain-authz, so the composition root wires the actual lookup.
  // Returns null for an address with no account, and requestPasswordReset
  // does the same amount of visible work either way — the caller's
  // response must not depend on which happened. The email returned is the
  // stored column, not necessarily byte-identical to what was submitted —
  // that is what the mail actually goes to.
  readonly findByEmail: (
    tx: TenantScopedDatabase,
    email: string,
  ) => Promise<{ subjectId: string; email: string; locale?: string | null | undefined } | null>;
  // Whether a mail may go to this address now. It decides only whether the
  // mail is queued, never the answer.
  readonly mailGate: MailGate;
}

export type RequestPasswordResetOutcome = { kind: 'requested' } | { kind: 'misconfigured' };

// Issues the token and queues the mail that carries it in one
// transaction — nothing here talks to a mail server. That is what makes
// the two paths indistinguishable in time as well as in content: an
// address with an account costs one INSERT more than one without, not an
// SMTP round trip more. A transport failure is the sender's to retry and
// an operator's to read (packages/email/src/usecase/send-pending.ts), and
// no longer arrives while a caller waits for an answer.
export async function requestPasswordReset(
  deps: RequestPasswordResetDeps,
  email: string,
): Promise<RequestPasswordResetOutcome> {
  const issuerBase = deps.issuerBase;
  if (issuerBase === undefined) {
    return { kind: 'misconfigured' };
  }

  await withTenant(deps.database.db, deps.tenantId, async (tx) => {
    // Read before the address is looked up, so the theme costs the same
    // whether or not it names an account.
    const mail = await mailContext(tx, deps.resolveMailLook, deps);
    const user = await deps.findByEmail(tx, email);
    if (user === null || !deps.mailGate('reset', deps.tenantId, user.email)) return;
    await enqueueResetLink(tx, { ...deps, issuerBase }, user, mail);
  });

  return { kind: 'requested' };
}

/** Where a link is minted for, and what the mail carrying it names. */
export interface ActionLinkTenant {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  readonly issuerBase: string;
  // The send time of the mail, from the caller's clock.
  readonly now: () => Date;
  // The sign-in the link came out of, so its page can lead the same browser
  // back to it; an administrator's link has none.
  readonly authenticationSessionId?: string | null;
  readonly resolveMailLook?: MailLookResolver | undefined;
}

/**
 * The token and the mail carrying it, in the caller's transaction: the one
 * write both a self-service reset request and an administrator's make, so
 * the link either sends is the same link.
 */
export async function enqueueResetLink(
  tx: TenantScopedDatabase,
  tenant: ActionLinkTenant,
  user: {
    readonly subjectId: string;
    readonly email: string;
    readonly locale?: string | null | undefined;
  },
  context?: MailContext,
): Promise<void> {
  const mail = context ?? (await mailContext(tx, tenant.resolveMailLook, tenant));
  const tokens = actionTokenRepository(tx);
  const { token } = await tokens.issue({
    tenantId: tenant.tenantId,
    subjectId: user.subjectId,
    type: 'reset_password',
    email: user.email,
    ...(tenant.authenticationSessionId === undefined
      ? {}
      : { authenticationSessionId: tenant.authenticationSessionId }),
    ttlSeconds: await tokens.lifetimeOf(tenant.tenantId, 'reset_password'),
  });
  const link = actionLink(tenant.issuerBase, tenant.tenantName, token);
  await outboxRepository(tx).enqueue({
    tenantId: tenant.tenantId,
    ...renderResetPassword({
      to: user.email,
      link,
      tenantDisplayName: tenant.tenantDisplayName,
      now: tenant.now(),
      locale: user.locale,
      ...mail,
    }),
  });
}

export interface AccountRecoveryDeps {
  // Ends every session and revokes every grant the subject holds. A reset is how
  // an account is recovered, and whoever held it before must not keep it.
  readonly endAccess: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
  // A link mailed to an address proves its mailbox. Where the account
  // registered itself and nobody verified the address, whoever registered it
  // may have enrolled a factor, so the factors go and the address is marked
  // verified. Returns how many factors went, or null when this account is not
  // one of those or the address is no longer the one the link was mailed to.
  readonly proveAddress: (
    tx: TenantScopedDatabase,
    subjectId: string,
    mailedTo: string | null,
  ) => Promise<number | null>;
}

/** What redeeming a link that sets a password owes the account it recovers. True when it removed factors. */
export async function recoverAccount(
  tx: TenantScopedDatabase,
  deps: AccountRecoveryDeps,
  subjectId: string,
  mailedTo: string | null,
): Promise<boolean> {
  await deps.endAccess(tx, subjectId);
  const removed = await deps.proveAddress(tx, subjectId, mailedTo);
  if (removed === null) return false;
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'account.address_proved',
    outcome: 'allowed',
    actorSubjectId: subjectId,
    resourceType: 'subject',
    resourceId: subjectId,
  });
  return removed > 0;
}

export interface CompletePasswordResetDeps extends AccountRecoveryDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
  readonly request: RequestContext;
  // Injected rather than imported, for the same reason
  // completeEmailVerification's getCurrentEmail and markVerified are:
  // @odudu/account never imports @odudu/domain-identity, where hashPassword
  // and the credentials table live. The composition root
  // (apps/server/src/app.ts) wires this to credentialRepository.setPassword.
  readonly setPassword: (
    tx: TenantScopedDatabase,
    subjectId: string,
    newPassword: string,
  ) => Promise<void>;
  // The tenant's own configured policy, and the username to check it
  // against — injected for the reason setPassword is: @odudu/account never
  // imports @odudu/domain-identity, where users.username lives.
  readonly passwordPolicy: PasswordPolicy;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
  readonly getUsername: (tx: TenantScopedDatabase, subjectId: string) => Promise<string>;
  // The one policy rule no candidate decides on its own: whether it is the
  // password already in force. Injected as the violations to report rather
  // than as a predicate, for the reason setPassword is — the stored hash,
  // the verifier and the message all live in @odudu/domain-identity.
  readonly unchangedPasswordViolations: (
    tx: TenantScopedDatabase,
    subjectId: string,
    candidate: string,
  ) => Promise<PolicyViolation[]>;
  // A subject who owed update-password has satisfied it by redeeming this
  // link, and must not be asked for a third password on their next login.
  // Injected because user_required_actions belongs to @odudu/authn-flows,
  // which @odudu/account does not depend on either.
  readonly clearPasswordUpdateAction: (
    tx: TenantScopedDatabase,
    subjectId: string,
  ) => Promise<void>;
}

export type CompletePasswordResetResult =
  | { kind: 'reset'; factorsRemoved: boolean }
  | { kind: 'invalid' }
  | { kind: 'invalid_password'; violations: PolicyViolation[] };

// One transaction: consuming the token, setting the new password, and
// retiring every other outstanding link that can set the same subject's
// password all commit or roll back together, so a reader never observes a
// spent link with the old password still active, nor a sibling link still
// redeemable after the account is recovered. The policy is checked against
// a non-consuming `peek` first: a weak password must not burn a link the
// redeemer could still use once they pick a compliant one.
export async function completePasswordReset(
  deps: CompletePasswordResetDeps,
  key: string,
  newPassword: string,
): Promise<CompletePasswordResetResult> {
  return withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx) => {
      const peeked = await actionTokenRepository(tx).peek(key);
      if (peeked?.type !== 'reset_password') return { kind: 'invalid' };

      const username = await deps.getUsername(tx, peeked.subjectId);
      const violations = deps.evaluatePassword(newPassword, deps.passwordPolicy, {
        username,
        email: peeked.email,
      });
      if (violations.length > 0) {
        return {
          kind: 'invalid_password',
          violations: withMinimum(violations, deps.passwordPolicy.minLength),
        };
      }

      // Before the link is spent, for the same reason the rules above are:
      // setting the password already in force restarts the tenant's
      // password_max_age_days on it, which would make an expired password
      // evadable by anybody who can read the account's mail.
      const unchanged = await deps.unchangedPasswordViolations(tx, peeked.subjectId, newPassword);
      if (unchanged.length > 0) return { kind: 'invalid_password', violations: unchanged };

      const record = await actionTokenRepository(tx).consume(key, 'reset_password');
      if (record === null) return { kind: 'invalid' };

      await deps.setPassword(tx, record.subjectId, newPassword);
      const factorsRemoved = await recoverAccount(tx, deps, record.subjectId, record.email);
      await deps.clearPasswordUpdateAction(tx, record.subjectId);
      await actionTokenRepository(tx).invalidateOutstandingPasswordLinks(record.subjectId);
      await auditRepository(tx).record({
        eventType: 'credential',
        action: 'password.reset',
        outcome: 'allowed',
        actorSubjectId: record.subjectId,
        resourceType: 'subject',
        resourceId: record.subjectId,
      });
      return { kind: 'reset', factorsRemoved };
    },
    deps.request,
  );
}
