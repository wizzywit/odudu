import { boundedText } from '#/adapter/bounded-body';
import { registeredErrorCode } from '#/service/error-code';
import { readMetadata, type AuthorizationServer } from '#/service/metadata';
import { StdioError } from '#/service/stdio-error';
import type { StdioTarget } from '#/service/stdio-target';
import { tokenSetFrom, type TokenSet } from '#/service/token-set';

const RESPONSE_CAP_BYTES = 65_536;
const TIMEOUT_MS = 30_000;
const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export interface OauthClientDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  // The built-in public client's id.
  readonly publicClientId: string;
}

export interface OauthClient {
  discover(): Promise<AuthorizationServer>;
  redeemCode(
    server: AuthorizationServer,
    input: { code: string; verifier: string; redirectUri: string; resource: string },
  ): Promise<TokenSet>;
  refresh(
    server: AuthorizationServer,
    input: { refreshToken: string; scope: string; resource: string },
  ): Promise<TokenSet>;
  clientCredentials(
    server: AuthorizationServer,
    input: { clientId: string; assertion: string; scope: string; resource: string },
  ): Promise<TokenSet>;
}

async function jsonOf(res: Response): Promise<unknown> {
  const text = await boundedText(res, RESPONSE_CAP_BYTES);
  if (text === undefined) {
    throw new StdioError(
      'mcp_response_too_large',
      'the authorization server answered with too much',
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function refusal(status: number, body: unknown): StdioError {
  const error =
    typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
  const code = registeredErrorCode(error);
  if (code === 'invalid_grant') {
    return new StdioError(
      'mcp_grant_ended',
      'the sign-in or key no longer grants access (invalid_grant)',
    );
  }
  return new StdioError(
    'mcp_token_endpoint',
    `the token endpoint refused the request (${String(status)}, ${code})`,
  );
}

function notFollowed(res: Response): StdioError | undefined {
  if (res.status < 300 || res.status >= 400) return undefined;
  return new StdioError(
    'mcp_redirect_refused',
    'the authorization server answered with a redirect, which is not followed',
  );
}

// The authorization server as a command-line client talks to it: discovery,
// and the three requests the stdio server makes of the token endpoint. Nothing
// is followed, a response is bounded, and a failure names the registered error
// code and the status, never the server's own words, a code, a token or an
// assertion.
export function createOauthClient(target: StdioTarget, deps: OauthClientDeps): OauthClient {
  const send = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await send(url, {
        ...init,
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new StdioError('mcp_unreachable', 'the authorization server could not be reached');
    }
  }

  async function token(
    server: AuthorizationServer,
    fields: Record<string, string>,
  ): Promise<TokenSet> {
    const res = await request(server.tokenEndpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const redirected = notFollowed(res);
    if (redirected !== undefined) throw redirected;
    const body = await jsonOf(res);
    if (!res.ok) throw refusal(res.status, body);
    return tokenSetFrom(body, now());
  }

  return {
    async discover() {
      const res = await request(target.metadataUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      const redirected = notFollowed(res);
      if (redirected !== undefined) throw redirected;
      const body = await jsonOf(res);
      if (!res.ok) {
        throw new StdioError(
          'mcp_discovery_failed',
          `the authorization server metadata could not be read (${String(res.status)})`,
        );
      }
      return readMetadata(body, target);
    },
    redeemCode: (server, input) =>
      token(server, {
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri,
        client_id: deps.publicClientId,
        resource: input.resource,
      }),
    refresh: (server, input) =>
      token(server, {
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: deps.publicClientId,
        scope: input.scope,
        resource: input.resource,
      }),
    clientCredentials: (server, input) =>
      token(server, {
        grant_type: 'client_credentials',
        client_id: input.clientId,
        client_assertion_type: JWT_BEARER,
        client_assertion: input.assertion,
        scope: input.scope,
        resource: input.resource,
      }),
  };
}
