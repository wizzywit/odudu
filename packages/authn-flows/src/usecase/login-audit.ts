import { withSavepoint, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditEventInput, type AuditReason } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import { type Logger } from '@odudu/kernel';
import {
  OTP,
  PASSKEY,
  PASSWORD,
  RECOVERY_CODE,
  type AuthenticatorName,
} from '#/service/authenticators/names';

type LoginAction = 'login.password' | 'login.otp' | 'login.recovery_code' | 'login.passkey';

const LOGIN_ACTIONS: Readonly<Record<AuthenticatorName, LoginAction>> = {
  [PASSWORD]: 'login.password',
  [OTP]: 'login.otp',
  [RECOVERY_CODE]: 'login.recovery_code',
  [PASSKEY]: 'login.passkey',
};

function isAuthenticatorName(name: string): name is AuthenticatorName {
  return Object.hasOwn(LOGIN_ACTIONS, name);
}

// Unreachable for a dispatched step: dispatchNext refuses a name the
// registry does not hold, and the registry is keyed on the same names.
function loginActionFor(authenticator: string): LoginAction {
  if (!isAuthenticatorName(authenticator)) {
    throw new Error(`authenticator '${authenticator}' has no audit action`);
  }
  return LOGIN_ACTIONS[authenticator];
}

export type AuditFailureLogger = Pick<Logger, 'error'>;

export interface LoginAudit {
  // Uncaught: a success nobody can find a record of is worse than a failed
  // login, so a failure to write it fails the attempt.
  allowed(authenticator: string, subjectId: string): Promise<void>;
  // Never changes the refusal the caller gets. The write runs in a savepoint
  // so a failed insert leaves the attempt's own writes (the failure count)
  // standing; the failure is logged instead. `lockoutTripped` adds the
  // lockout row to the same statement as the step's.
  refused(
    authenticator: string,
    subjectId: string | null,
    reason: AuditReason,
    lockoutTripped?: boolean,
  ): Promise<void>;
  factorOffered(form: string, subjectId: string): Promise<void>;
}

/**
 * The rows one login attempt writes, into the transaction the attempt runs
 * in. The client is resolved here, before any factor runs, and every refusal
 * runs the same savepoint and one INSERT whatever it carries, so a wrong
 * password, an unknown account and a locked one issue the same statements.
 */
export async function loginAuditFor(
  tx: TenantScopedDatabase,
  authSessionId: string,
  oauthClientId: string,
  logger: AuditFailureLogger,
): Promise<LoginAudit> {
  const client = await clientRepository(tx).byClientId(oauthClientId);
  const common = {
    eventType: 'authentication',
    actorClientId: client === null ? null : client.id,
    resourceType: 'authentication_session',
    resourceId: authSessionId,
  } as const;
  const audit = auditRepository(tx);

  return {
    allowed: (authenticator, subjectId) =>
      audit.record({
        ...common,
        action: loginActionFor(authenticator),
        outcome: 'allowed',
        actorSubjectId: subjectId,
        detail: { factor: authenticator },
      }),
    refused: async (authenticator, subjectId, reason, lockoutTripped = false) => {
      const events: AuditEventInput[] = [
        {
          ...common,
          action: loginActionFor(authenticator),
          outcome: 'refused',
          actorSubjectId: subjectId,
          detail: { factor: authenticator, reason },
        },
      ];
      if (lockoutTripped) {
        events.push({
          ...common,
          action: 'lockout.tripped',
          outcome: 'refused',
          actorSubjectId: subjectId,
          detail: { reason: 'locked_out' },
        });
      }
      try {
        await withSavepoint(tx, (inner) => auditRepository(inner).recordAll(events));
      } catch (error) {
        logger.error(
          { err: error, authSessionId, action: loginActionFor(authenticator) },
          'could not record a refused login step',
        );
      }
    },
    factorOffered: (form, subjectId) =>
      audit.record({
        ...common,
        action: 'factor.offered',
        outcome: 'allowed',
        actorSubjectId: subjectId,
        detail: { factor: form },
      }),
  };
}
