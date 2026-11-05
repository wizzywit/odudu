/**
 * What the registration endpoint consults before it does any work for a
 * tenant on the `mcp` policy. One budget per tenant and client address, so one
 * noisy address cannot spend another's. The concrete instance is built on
 * `slidingWindow` in `apps/server/src/app.ts`, injected so this package never
 * depends on the app, the way `ClientSecretLimiter` is.
 */
export interface RegistrationLimiter {
  check: (tenantId: string, origin: string) => { allowed: boolean; retryAfterSeconds: number };
}
