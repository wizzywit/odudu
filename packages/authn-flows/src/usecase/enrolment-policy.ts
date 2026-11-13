import { type TenantScopedDatabase } from '@odudu/db';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type AuthenticatorPolicy } from '#/service/authenticator-policy';
import { effectiveAuthenticatorPolicy, flowIdOf } from '#/service/step-settings';
import { offeredTotp, totpOfferOf, type TotpOfferedParameters } from '#/service/totp-offer';
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

// Remembers what the enrolment page offered for this secret, so the code that
// confirms it is judged by those parameters and not by a policy saved since.
export async function rememberTotpOffer(
  tx: TenantScopedDatabase,
  authSessionId: string | undefined,
  secret: string,
  parameters: TotpOfferedParameters,
): Promise<void> {
  if (authSessionId === undefined) return;
  await authenticationSessionRepository(tx).recordTotpOffer(
    authSessionId,
    totpOfferOf(secret, parameters),
  );
}

// The parameters a confirming code is judged by: what was offered for this
// secret, else the policy now in force.
export async function confirmedTotpParameters(
  tx: TenantScopedDatabase,
  tenantId: string,
  authSessionId: string,
  secret: string,
): Promise<TotpOfferedParameters> {
  const offered = offeredTotp(
    await authenticationSessionRepository(tx).byId(authSessionId),
    secret,
  );
  return offered ?? (await enrolmentPolicy(tx, tenantId, authSessionId)).totp;
}
