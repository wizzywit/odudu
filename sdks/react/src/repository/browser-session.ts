import { beginSignIn, completeSignIn, refresh, signOutUrl, type TokenSet } from '@odudu-io/oidc';
import { currentUrl, replaceUrl } from '#/adapter/location';
import { savePending, takePending } from '#/adapter/pending-storage';
import { isCallback, withoutCallbackParams } from '#/services/callback';
import { audienceNotGranted, noPendingSignIn } from '#/services/errors';
import { parsePending } from '#/services/pending';
import { depsOf, signInOptions } from '#/services/sign-in';
import { audienceKey, isFresh } from '#/services/tokens';
import type { BrowserMode, SignInChoices } from '#/types';

// The address to send the person to. What the redirect needs to come back is
// kept for the length of it.
export async function startSignIn(mode: BrowserMode, choices: SignInChoices): Promise<string> {
  const { url, pending } = await beginSignIn(signInOptions(mode, choices), depsOf(mode));
  savePending(pending);
  return url;
}

// Reads the redirect the issuer sent the person back with, when this load is
// one. The address is cleaned and the record spent whatever the outcome.
export async function finishSignIn(mode: BrowserMode): Promise<TokenSet | undefined> {
  const href = currentUrl();
  if (!isCallback(new URL(href).search)) return undefined;
  const stored = takePending();
  replaceUrl(withoutCallbackParams(href));
  const pending = parsePending(stored);
  if (pending === undefined) throw noPendingSignIn();
  return completeSignIn(href, pending, depsOf(mode));
}

export function signOutAddress(mode: BrowserMode, tokens: TokenSet): Promise<string> {
  return signOutUrl(
    {
      issuer: mode.issuer,
      idToken: tokens.idToken,
      ...(mode.postLogoutRedirectUri === undefined
        ? {}
        : { postLogoutRedirectUri: mode.postLogoutRedirectUri }),
    },
    depsOf(mode),
  );
}

export interface FreshToken {
  tokens: TokenSet;
  accessToken: string;
}

// The token for `resource`, renewed through the core when it is about to
// lapse. The core makes one request for callers sharing a refresh token.
export async function freshToken(
  mode: BrowserMode,
  tokens: TokenSet,
  resource: string | undefined,
): Promise<FreshToken> {
  const key = audienceKey(tokens, resource);
  const held = tokens.byAudience[key];
  if (held === undefined) throw audienceNotGranted(resource);
  if (isFresh(held, Date.now())) return { tokens, accessToken: held.accessToken };
  const renewed = await refresh(tokens, resource === undefined ? {} : { resource }, depsOf(mode));
  const entry = renewed.byAudience[key];
  if (entry === undefined) throw audienceNotGranted(resource);
  return { tokens: renewed, accessToken: entry.accessToken };
}
