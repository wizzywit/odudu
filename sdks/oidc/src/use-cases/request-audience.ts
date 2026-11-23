import { buildAuthorizationRequest } from '#/repository/authorization-request';
import { audienceSignIn } from '#/services/sign-in-request';
import { discover } from '#/use-cases/discover';
import type { AudienceRequest, Deps, Pending } from '#/types';

// Starts a second authorization for one more audience, which a refresh cannot
// add: the address to send the person to and the record completeSignIn needs.
// Completing it yields a token set filed under that audience. With `silent`
// the request carries `prompt=none`; whether that avoids every interactive
// step has not been tested, so it is off unless asked for.
export async function requestAudience(
  request: AudienceRequest,
  deps: Deps = {},
): Promise<{ url: string; pending: Pending }> {
  return buildAuthorizationRequest(
    await discover(request.issuer, deps),
    audienceSignIn(request),
    request.silent === true,
  );
}
