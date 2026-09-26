import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditReason } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import { OTP, PASSKEY, PASSWORD, RECOVERY_CODE } from '#/service/authenticators/names';

type LoginAction = 'login.password' | 'login.otp' | 'login.recovery_code' | 'login.passkey';

const LOGIN_ACTIONS: Readonly<Record<string, LoginAction>> = {
  [PASSWORD]: 'login.password',
  [OTP]: 'login.otp',
  [RECOVERY_CODE]: 'login.recovery_code',
  [PASSKEY]: 'login.passkey',
};

function loginActionFor(authenticator: string): LoginAction {
  const action = LOGIN_ACTIONS[authenticator];
  if (action === undefined) {
    throw new Error(`authenticator '${authenticator}' has no audit action`);
  }
  return action;
}

export interface LoginAudit {
  // `reason` absent records the step as allowed.
  step(authenticator: string, subjectId: string | null, reason?: AuditReason): Promise<void>;
  lockoutTripped(subjectId: string | null): Promise<void>;
  factorOffered(form: string, subjectId: string): Promise<void>;
}

/**
 * The rows one login attempt writes, into the transaction the attempt runs
 * in. The client is resolved here, before any factor runs, so a wrong
 * password, an unknown account and a locked one all pay for the same lookup.
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
    step: (authenticator, subjectId, reason) =>
      audit.record({
        ...common,
        action: loginActionFor(authenticator),
        outcome: reason === undefined ? 'allowed' : 'refused',
        actorSubjectId: subjectId,
        detail:
          reason === undefined ? { factor: authenticator } : { factor: authenticator, reason },
      }),
    lockoutTripped: (subjectId) =>
      audit.record({
        ...common,
        action: 'lockout.tripped',
        outcome: 'refused',
        actorSubjectId: subjectId,
        detail: { reason: 'locked_out' },
      }),
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
