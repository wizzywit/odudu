import { type TenantScopedDatabase } from '@odudu/db';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type AuthenticatorPolicy } from '#/service/authenticator-policy';
import { effectiveAuthenticatorPolicy, flowIdOf } from '#/service/step-settings';
import { flowSteps } from '#/usecase/flow-steps';

// What an enrolment made during this sign-in is made under: the tenant's
// authenticator settings with those of the flow the sign-in runs over them.
// With no sign-in to name a flow, the tenant's default flow decides.
export async function enrolmentPolicy(
  tx: TenantScopedDatabase,
  tenantId: string,
  authSessionId: string | undefined,
): Promise<AuthenticatorPolicy> {
  const tenant = await tenantSettingsRepository(tx).authenticatorPolicy(tenantId);
  const record =
    authSessionId === undefined
      ? null
      : await authenticationSessionRepository(tx).byId(authSessionId);
  return effectiveAuthenticatorPolicy(tenant, await flowSteps(tx, tenantId, flowIdOf(record)));
}
