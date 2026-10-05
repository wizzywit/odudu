import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import { outboxRepository, renderRequiredActions } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/tenant-settings';
import { actionLabel, orderedActions, type LinkedRequiredAction } from '#/service/required-actions';
import { type ActionLinkTenant } from '#/usecase/reset-password';

export interface ActionsLink {
  readonly actions: readonly string[];
  readonly redirectUri: string | null;
  /** The row id of the client that registered `redirectUri`. */
  readonly redirectClientId: string | null;
}

/**
 * The token and the mail carrying it, in the caller's transaction. The link
 * signs its subject in by their mailbox, as a reset link does, so it lives as
 * long as one.
 */
export async function enqueueActionsLink(
  tx: TenantScopedDatabase,
  tenant: ActionLinkTenant,
  user: { readonly subjectId: string; readonly email: string },
  link: ActionsLink,
): Promise<void> {
  const actions = orderedActions(link.actions);
  if (actions.length === 0) throw new Error('an actions link names no action this server takes');
  const tokens = actionTokenRepository(tx);
  const { token } = await tokens.issue({
    tenantId: tenant.tenantId,
    subjectId: user.subjectId,
    type: 'execute_actions',
    email: user.email,
    actions,
    redirectUri: link.redirectUri,
    redirectClientId: link.redirectClientId,
    ttlSeconds: await tokens.lifetimeOf(tenant.tenantId, 'execute_actions'),
  });
  const url = `${tenant.issuerBase}/tenants/${tenant.tenantName}/login-actions/action-token?key=${encodeURIComponent(token)}`;
  await outboxRepository(tx).enqueue({
    tenantId: tenant.tenantId,
    ...renderRequiredActions({
      to: user.email,
      link: url,
      tenantDisplayName: tenant.tenantDisplayName,
      actions: actions.map(actionLabel),
    }),
  });
}

export interface CompleteRequiredActionsDeps {
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
  readonly unchangedPasswordViolations: (
    tx: TenantScopedDatabase,
    subjectId: string,
    candidate: string,
  ) => Promise<PolicyViolation[]>;
  readonly clearPasswordUpdateAction: (
    tx: TenantScopedDatabase,
    subjectId: string,
  ) => Promise<void>;
  /** Whether the client still registers the URI the link was minted to offer. */
  readonly redirectStillRegistered: (
    tx: TenantScopedDatabase,
    clientId: string,
    redirectUri: string,
  ) => Promise<boolean>;
  /** Owes the subject each action, so its next sign-in asks for it. */
  readonly addRequiredActions: (
    tx: TenantScopedDatabase,
    tenantId: string,
    subjectId: string,
    actions: readonly LinkedRequiredAction[],
  ) => Promise<void>;
}

export type CompleteRequiredActionsResult =
  | { kind: 'done'; remaining: readonly string[]; redirectUri: string | null }
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
  return withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx) => {
      const tokens = actionTokenRepository(tx);
      const peeked = await tokens.peek(key);
      if (peeked?.type !== 'execute_actions') return { kind: 'invalid' };
      const actions = orderedActions(peeked.actions ?? []);
      const setsPassword = actions.includes('update-password');

      if (setsPassword) {
        if (newPassword === undefined) return { kind: 'password_required' };
        const username = await deps.getUsername(tx, peeked.subjectId);
        const violations = deps.evaluatePassword(newPassword, deps.passwordPolicy, {
          username,
          email: peeked.email,
        });
        if (violations.length > 0) return { kind: 'invalid_password', violations };
        const unchanged = await deps.unchangedPasswordViolations(tx, peeked.subjectId, newPassword);
        if (unchanged.length > 0) return { kind: 'invalid_password', violations: unchanged };
      }

      const record = await tokens.consume(key, 'execute_actions');
      if (record === null) return { kind: 'invalid' };

      if (setsPassword && newPassword !== undefined) {
        await deps.setPassword(tx, record.subjectId, newPassword);
        await deps.clearPasswordUpdateAction(tx, record.subjectId);
        await tokens.invalidateOutstandingPasswordLinks(record.subjectId);
        await auditRepository(tx).record({
          eventType: 'credential',
          action: 'password.reset',
          outcome: 'allowed',
          actorSubjectId: record.subjectId,
          resourceType: 'subject',
          resourceId: record.subjectId,
        });
      }
      const remaining = actions.filter((action) => action !== 'update-password');
      if (remaining.length > 0)
        await deps.addRequiredActions(tx, deps.tenantId, record.subjectId, remaining);
      const { redirectUri, redirectClientId } = record;
      const offered =
        redirectUri !== null &&
        redirectClientId !== null &&
        (await deps.redirectStillRegistered(tx, redirectClientId, redirectUri));
      return {
        kind: 'done',
        remaining: remaining.map(actionLabel),
        redirectUri: offered ? redirectUri : null,
      };
    },
    deps.request,
  );
}
