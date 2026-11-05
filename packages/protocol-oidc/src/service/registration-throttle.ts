/** Which budget refused: the client's own address, or the tenant over every address. */
export type RegistrationBudgetScope = 'address' | 'tenant';

/**
 * What the registration endpoint consults before it does any work for a
 * tenant on the `mcp` policy. One budget per tenant and client address, and
 * one for the tenant over every address, so one noisy address cannot spend
 * another's and many together cannot fill the tenant. The concrete instance
 * is built on `slidingWindow` in `apps/server/src/mcp-registration-budget.ts`,
 * injected so this package never depends on the app, the way
 * `ClientSecretLimiter` is. A refusal names its scope; none means the address.
 */
export interface RegistrationLimiter {
  check: (
    tenantId: string,
    origin: string,
  ) => { allowed: boolean; retryAfterSeconds: number; scope?: RegistrationBudgetScope };
}

export const RATE_LIMIT_DESCRIPTIONS: Record<RegistrationBudgetScope, string> = {
  address: 'too many registrations from this address; retry later',
  tenant: 'this tenant has received too many registrations; retry later',
};
