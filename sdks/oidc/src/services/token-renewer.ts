import type { AudienceToken } from '#/types';

// Holds one token and gives it until `skewMs` before it expires, or until half
// its lifetime is gone when that is sooner: a token shorter than the skew is
// then renewed once per half-life, never on every call. Callers that
// arrive while a renewal is out share it, whether it succeeds or fails; a
// failure is not kept, so the next call asks again. There is no timer: a
// token is renewed by the call that finds it stale.
export function tokenRenewer(
  fetchToken: () => Promise<AudienceToken>,
  now: () => number,
  skewMs: number,
): () => Promise<string> {
  let held: { token: AudienceToken; renewAt: number } | undefined;
  let renewal: Promise<string> | undefined;
  return () => {
    if (held !== undefined && now() < held.renewAt) {
      return Promise.resolve(held.token.accessToken);
    }
    renewal ??= fetchToken()
      .then((token) => {
        const skew = Math.min(skewMs, Math.floor((token.expiresAt - now()) / 2));
        held = { token, renewAt: token.expiresAt - skew };
        return token.accessToken;
      })
      .finally(() => {
        renewal = undefined;
      });
    return renewal;
  };
}
