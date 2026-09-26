import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditEventInput, type AuditReason } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
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

export interface LoginAudit {
  // `reason` absent records the step as allowed. `lockoutTripped` adds the
  // lockout row to the same statement as the step's.
  step(
    authenticator: string,
    subjectId: string | null,
    reason?: AuditReason,
    lockoutTripped?: boolean,
  ): Promise<void>;
  factorOffered(form: string, subjectId: string): Promise<void>;
}

/**
 * The rows one login attempt writes, into the transaction the attempt runs
 * in. The client is resolved here, before any factor runs, and each call
 * below is one INSERT whatever it carries, so a wrong password, an unknown
 * account and a locked one issue the same statements.
 */
export async function loginAuditFor(
  tx: TenantScopedDatabase,
  authSessionId: string,
  oauthClientId: string,
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
    step: (authenticator, subjectId, reason, lockoutTripped = false) => {
      const events: AuditEventInput[] = [
        {
          ...common,
          action: loginActionFor(authenticator),
          outcome: reason === undefined ? 'allowed' : 'refused',
          actorSubjectId: subjectId,
          detail:
            reason === undefined ? { factor: authenticator } : { factor: authenticator, reason },
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
      return audit.recordAll(events);
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
