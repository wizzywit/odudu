import { actionLink } from '#/service/action-link';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import {
  auditRepository,
  type BreachedCheckOutcome,
  type RequestContext,
} from '@odudu/domain-audit';
import { mailContext, outboxRepository, renderRequiredActions } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { mailAddressOf } from '#/usecase/mail-address';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/tenant-settings';
import { type BreachedCheck, type BreachedPrepared } from '#/service/breached-check';
import { withMinimum } from '#/service/password-violations';
import { orderedActions, type LinkedRequiredAction } from '#/service/required-actions';
import {
  recoverAccount,
  type AccountRecoveryDeps,
  type ActionLinkTenant,
} from '#/usecase/reset-password';

export interface ActionsLink {
  readonly actions: readonly string[];
}

/**
 * The token and the mail carrying it, in the caller's transaction. The link
 * signs its subject in by their mailbox, as a reset link does, so it lives as
 * long as one.
 */
export async function enqueueActionsLink(
  tx: TenantScopedDatabase,
  tenant: ActionLinkTenant,
  user: {
    readonly subjectId: string;
    readonly email: string;
    readonly locale?: string | null | undefined;
  },
  link: ActionsLink,
): Promise<void> {
  const actions = orderedActions(link.actions);
  if (actions.length === 0) throw new Error('an actions link names no action this server takes');
  const address = await mailAddressOf(tx, tenant);
  const mail = await mailContext(tx, tenant.resolveMailLook, { ...tenant, address });
  const tokens = actionTokenRepository(tx);
  const { token } = await tokens.issue({
    tenantId: tenant.tenantId,
    subjectId: user.subjectId,
    type: 'execute_actions',
    email: user.email,
    actions,
    returnTo: tenant.returnTo,
    ttlSeconds: await tokens.lifetimeOf(tenant.tenantId, 'execute_actions'),
  });
  const url = actionLink(address, token);
  await outboxRepository(tx).enqueue({
    tenantId: tenant.tenantId,
    ...renderRequiredActions({
      to: user.email,
      link: url,
      tenantDisplayName: tenant.tenantDisplayName,
      now: tenant.now(),
      actions,
      locale: user.locale,
      ...mail,
    }),
  });
}

export interface CompleteRequiredActionsDeps extends AccountRecoveryDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
  readonly request: RequestContext;
  readonly setPassword: (
    tx: TenantScopedDatabase,
    subjectId: string,
    password: string,
  ) => Promise<void>;
  readonly passwordPolicy: PasswordPolicy;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
  readonly getUsername: (tx: TenantScopedDatabase, subjectId: string) => Promise<string>;
  readonly breachedCheck: BreachedCheck;
  readonly unchangedPasswordViolations: (
    tx: TenantScopedDatabase,
    subjectId: string,
    candidate: string,
  ) => Promise<PolicyViolation[]>;
  readonly clearPasswordUpdateAction: (
    tx: TenantScopedDatabase,
    subjectId: string,
  ) => Promise<void>;
  /** Owes the subject each action, so its next sign-in asks for it. */
  readonly addRequiredActions: (
    tx: TenantScopedDatabase,
    tenantId: string,
    subjectId: string,
    actions: readonly LinkedRequiredAction[],
  ) => Promise<void>;
}

export type CompleteRequiredActionsResult =
  | { kind: 'done'; remaining: readonly LinkedRequiredAction[]; factorsRemoved: boolean }
  | { kind: 'invalid' }
  | { kind: 'password_required' }
  | { kind: 'invalid_password'; violations: PolicyViolation[] };

/**
 * Redeems an actions link. A new password, where the link asks for one, is
 * set here under the reset link's rules, since the link stands in for the
 * old one. Every other action needs the subject signed in, by their password
 * and whatever second factor they hold, so it is owed rather than done: the
 * next sign-in parks on it, as it does for one an administrator set. The
 * link alone never enrols a factor.
 */
export async function completeRequiredActions(
  deps: CompleteRequiredActionsDeps,
  key: string,
  newPassword: string | undefined,
): Promise<CompleteRequiredActionsResult> {
  // Read-only: the rules decide first, and a remote service is asked, if the
  // tenant uses one, with no connection held.
  const early = await withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx): Promise<{ stop: CompleteRequiredActionsResult } | { sets: boolean }> => {
      const peeked = await actionTokenRepository(tx).peek(key);
      if (peeked?.type !== 'execute_actions') return { stop: { kind: 'invalid' } };
      if (!orderedActions(peeked.actions ?? []).includes('update-password')) {
        return { sets: false };
      }
      if (newPassword === undefined) return { stop: { kind: 'password_required' } };
      const violations = deps.evaluatePassword(newPassword, deps.passwordPolicy, {
        username: await deps.getUsername(tx, peeked.subjectId),
        email: peeked.email,
      });
      if (violations.length === 0) return { sets: true };
      return {
        stop: {
          kind: 'invalid_password',
          violations: withMinimum(violations, deps.passwordPolicy.minLength),
        },
      };
    },
    deps.request,
  );
  if ('stop' in early) return early.stop;
  const prepared =
    early.sets && newPassword !== undefined
      ? await deps.breachedCheck.prepare(deps.database.db, deps.tenantId, newPassword, deps.request)
      : null;
  return writeActions(deps, key, newPassword, prepared);
}

async function writeActions(
  deps: CompleteRequiredActionsDeps,
  key: string,
  newPassword: string | undefined,
  prepared: BreachedPrepared | null,
): Promise<CompleteRequiredActionsResult> {
  return withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx) => {
      const tokens = actionTokenRepository(tx);
      const peeked = await tokens.peek(key);
      if (peeked?.type !== 'execute_actions') return { kind: 'invalid' };
      const actions = orderedActions(peeked.actions ?? []);
      const setsPassword = actions.includes('update-password');
      let breachedAudit: BreachedCheckOutcome | undefined;

      if (setsPassword) {
        if (newPassword === undefined) return { kind: 'password_required' };
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
        // The link changed under the read above: nothing was asked, so nothing is judged.
        if (prepared === null) return { kind: 'invalid' };
        const breached = await deps.breachedCheck.judge(tx, deps.tenantId, newPassword, prepared);
        if (breached.violations.length > 0) {
          return { kind: 'invalid_password', violations: [...breached.violations] };
        }
        breachedAudit = breached.audit;
        const unchanged = await deps.unchangedPasswordViolations(tx, peeked.subjectId, newPassword);
        if (unchanged.length > 0) return { kind: 'invalid_password', violations: unchanged };
      }

      const record = await tokens.consume(key, 'execute_actions');
      if (record === null) return { kind: 'invalid' };

      let factorsRemoved = false;
      if (setsPassword && newPassword !== undefined) {
        await deps.setPassword(tx, record.subjectId, newPassword);
        factorsRemoved = await recoverAccount(tx, deps, record.subjectId, record.email);
        await deps.clearPasswordUpdateAction(tx, record.subjectId);
        await tokens.invalidateOutstandingPasswordLinks(record.subjectId);
        await auditRepository(tx).record({
          eventType: 'credential',
          action: 'password.reset',
          outcome: 'allowed',
          actorSubjectId: record.subjectId,
          resourceType: 'subject',
          resourceId: record.subjectId,
          ...(breachedAudit === undefined ? {} : { detail: { breached_check: breachedAudit } }),
        });
      }
      const remaining = actions.filter((action) => action !== 'update-password');
      if (remaining.length > 0)
        await deps.addRequiredActions(tx, deps.tenantId, record.subjectId, remaining);
      return { kind: 'done', remaining, factorsRemoved };
    },
    deps.request,
  );
}
