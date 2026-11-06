import type { OpenUrl } from '#/adapter/browser';
import type { LoopbackListener } from '#/adapter/loopback-listener';
import type { OauthClient } from '#/adapter/oauth-client';
import { authorizationUrl } from '#/service/authorization-url';
import { checkCallback, describeRefusal } from '#/service/callback';
import { pkceFor } from '#/service/pkce';
import { StdioError } from '#/service/stdio-error';
import type { TokenSet } from '#/service/token-set';

export interface LoopbackLoginDeps {
  readonly oauth: Pick<OauthClient, 'discover' | 'redeemCode'>;
  readonly listen: () => Promise<LoopbackListener>;
  readonly openBrowser: OpenUrl;
  readonly entropy: (bytes: number) => Uint8Array;
  // One line to a person, on standard error.
  readonly say: (line: string) => void;
  // The built-in public client's id.
  readonly clientId: string;
  // The audience the token is for: the admin API.
  readonly resource: string;
  readonly scope: 'mcp:read' | 'mcp:write';
}

// A sign-in in the person's browser, for a command-line client (RFC 8252 §7):
// the authorization code grant with PKCE S256 as the built-in public client,
// answered on a loopback listener that takes one request. The response is
// judged (issuer, then state) before the code leaves this process, and the
// token endpoint is only asked once it passes. No password is typed here.
export async function loopbackLogin(deps: LoopbackLoginDeps): Promise<TokenSet> {
  const server = await deps.oauth.discover();
  const { verifier, challenge } = pkceFor(deps.entropy(32));
  const state = Buffer.from(deps.entropy(24)).toString('base64url');
  const listener = await deps.listen();
  try {
    const address = authorizationUrl(server.authorizationEndpoint, {
      clientId: deps.clientId,
      redirectUri: listener.redirectUri,
      scope: deps.scope,
      state,
      challenge,
      resource: deps.resource,
    });
    deps.say('odudu mcp: sign in in the browser that opens; waiting for you to finish');
    if (!(await deps.openBrowser(address))) {
      deps.say(`odudu mcp: the browser did not open; open this address to sign in: ${address}`);
    }
    const verdict = checkCallback(await listener.callback, {
      state,
      issuer: server.issuer,
      issuerAdvertised: server.issuerAdvertised,
    });
    if (verdict.kind === 'refused') {
      throw new StdioError('mcp_login_refused', describeRefusal(verdict));
    }
    return await deps.oauth.redeemCode(server, {
      code: verdict.code,
      verifier,
      redirectUri: listener.redirectUri,
      resource: deps.resource,
    });
  } finally {
    await listener.close();
  }
}
