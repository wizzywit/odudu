import { beginSignIn, completeSignIn, refresh, signOutUrl } from '#/adapter/oidc';
import { authOf, callbackUrlOf, type BffConfig } from '#/services/config';
import type { Pending, TokenSet } from '@odudu-io/oidc';

export interface IdentityProvider {
  begin(): Promise<{ url: string; pending: Pending }>;
  complete(requestUrl: string, pending: Pending): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  signOut(tokens: TokenSet): Promise<string>;
}

export function createIdentityProvider(config: BffConfig): IdentityProvider {
  const deps = config.deps ?? {};
  return {
    begin: () =>
      beginSignIn(
        {
          issuer: config.issuer,
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          scope: config.scope,
        },
        deps,
      ),
    complete: (requestUrl, pending) =>
      completeSignIn(callbackUrlOf(config.redirectUri, requestUrl), pending, deps, authOf(config)),
    refresh: (tokens) => refresh(tokens, authOf(config), deps),
    signOut: (tokens) =>
      signOutUrl(
        {
          issuer: tokens.issuer,
          idToken: tokens.idToken,
          ...(config.postLogoutRedirectUri === undefined
            ? {}
            : { postLogoutRedirectUri: config.postLogoutRedirectUri }),
        },
        deps,
      ),
  };
}
