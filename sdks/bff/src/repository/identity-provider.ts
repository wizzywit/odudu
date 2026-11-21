import { beginSignIn, completeSignIn, discover, OduduError, refresh } from '#/adapter/oidc';
import { authOf, callbackUrlOf, logoutAddressOf, type BffConfig } from '#/services/config';
import type { Pending, TokenSet } from '@odudu-io/oidc';

export interface IdentityProvider {
  begin(): Promise<{ url: string; pending: Pending }>;
  complete(requestUrl: string, pending: Pending): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  signOut(): Promise<string>;
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
          ...(config.resource === undefined ? {} : { resource: config.resource }),
        },
        deps,
      ),
    complete: (requestUrl, pending) =>
      completeSignIn(callbackUrlOf(config.redirectUri, requestUrl), pending, deps, authOf(config)),
    refresh: (tokens) => refresh(tokens, authOf(config), deps),
    signOut: async () => {
      const { end_session_endpoint: endpoint } = await discover(config.issuer, deps);
      if (endpoint === undefined) {
        throw new OduduError('discovery_failed', 'the metadata names no end_session_endpoint');
      }
      return logoutAddressOf(
        endpoint,
        config.clientId,
        config.postLogoutRedirectUri,
        deps.allowInsecureRequests === true,
      );
    },
  };
}
