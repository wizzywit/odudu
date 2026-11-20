import type { AudienceToken } from '#/types';

// Holds one token and gives it until `skewMs` before it expires. Callers that
// arrive while a renewal is out share it, whether it succeeds or fails; a
// failure is not kept, so the next call asks again. There is no timer: a
// token is renewed by the call that finds it stale.
export function tokenRenewer(
  fetchToken: () => Promise<AudienceToken>,
  now: () => number,
  skewMs: number,
): () => Promise<string> {
  let held: AudienceToken | undefined;
  let renewal: Promise<string> | undefined;
  return () => {
    if (held !== undefined && now() < held.expiresAt - skewMs) {
      return Promise.resolve(held.accessToken);
    }
    renewal ??= fetchToken()
      .then((token) => {
        held = token;
        return token.accessToken;
      })
      .finally(() => {
        renewal = undefined;
      });
    return renewal;
  };
}
