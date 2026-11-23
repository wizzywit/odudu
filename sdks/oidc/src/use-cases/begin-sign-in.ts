import { buildAuthorizationRequest } from '#/repository/authorization-request';
import { refuseConflictingOptions } from '#/services/sign-in-request';
import { discover } from '#/use-cases/discover';
import type { Deps, Pending, SignInOptions } from '#/types';

// Starts a sign-in: the address to send the person to, and the record
// completeSignIn needs when they come back. The core keeps nothing.
export async function beginSignIn(
  options: SignInOptions,
  deps: Deps = {},
): Promise<{ url: string; pending: Pending }> {
  refuseConflictingOptions(options);
  return buildAuthorizationRequest(await discover(options.issuer, deps), options);
}
