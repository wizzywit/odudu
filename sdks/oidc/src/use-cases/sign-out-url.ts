import { signOutAddress } from '#/services/sign-out-request';
import { discover } from '#/use-cases/discover';
import type { Deps, SignOutOptions } from '#/types';

// The address that ends the person's session (RP-Initiated Logout). Odudu asks
// the person to confirm by default, so they land on a confirmation page and
// are sent on to `postLogoutRedirectUri` only after they agree; a client
// configured to skip the page signs them out at once. The redirect address
// must be registered for the client, and the server honors `state` only
// together with it.
export async function signOutUrl(options: SignOutOptions, deps: Deps = {}): Promise<string> {
  return signOutAddress(
    await discover(options.issuer, deps),
    options,
    deps.allowInsecureRequests === true,
  );
}
