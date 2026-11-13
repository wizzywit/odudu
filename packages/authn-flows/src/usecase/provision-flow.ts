import { type TenantScopedDatabase } from '@odudu/db';
import { provisionTenantDefaults } from '@odudu/domain-tenant';
import { flowRepository } from '#/repository/flows';
import { type FlowStep } from '#/schema/flow';
import { isRegisteredAuthenticator } from '#/usecase/executor';

// A passkey or a password gets a subject through the first group; the OTP
// step's own applicability — enrolled, or the tenant demands it, and never
// after a passkey, which is already two factors — is decided by the
// evaluator, not by this list. The recovery-code step is last and is
// applicable only to a submission that actually carries a code, which is
// what lets it substitute for the OTP step without ever competing with it;
// migration 0137 backfills a tenant's default flow from this list when it has no
// steps of its own.
export const BROWSER_FLOW_DEFAULT: readonly FlowStep[] = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
  { authenticator: 'recovery-code', requirement: 'conditional' },
];

// Seeds the browser flow alone. Exported so a caller that wants only the
// scope vocabulary, or that cannot depend on this package (domain-tenant
// itself, underneath it), can still reach for provisionTenantDefaults
// without carrying a flow it does not want.
export async function provisionBrowserFlow(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<void> {
  // An unresolvable authenticator name has to fail here, not the first
  // time somebody tries to log in against the step it produces.
  for (const step of BROWSER_FLOW_DEFAULT) {
    if (!isRegisteredAuthenticator(step.authenticator)) {
      throw new Error(`unregistered authenticator '${step.authenticator}' in browser flow`);
    }
  }
  await flowRepository(tx).replaceDefaultSteps(tenantId, BROWSER_FLOW_DEFAULT);
}

// A tenant is not usable until it has both a scope vocabulary and a flow to
// authenticate against — provisionTenantDefaults (@odudu/domain-tenant) gives
// the first, provisionBrowserFlow the second. This is the one function that
// calls both, so a tenant-creation site cannot drift into calling only one of
// them; every caller standing up a real tenant should reach for this rather
// than the two pieces separately.
export async function provisionTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await provisionTenantDefaults(tx, tenantId);
  await provisionBrowserFlow(tx, tenantId);
}
