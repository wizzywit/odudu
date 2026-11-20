import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeServer {
  issuer: string;
  // Merged over the claims of every ID token the token endpoint mints.
  claims: Record<string, unknown>;
  // Refused instead of tokens when set.
  tokenError: { error: string; error_description?: string } | undefined;
  expiresIn: number;
  // Whether the token endpoint issues a refresh token.
  issueRefreshToken: boolean;
  // How long a refresh takes to answer, so concurrent callers overlap.
  refreshDelayMs: number;
  tokenRequests: URLSearchParams[];
  tokenAuthorizations: (string | undefined)[];
  spentRefreshTokens: Set<string>;
  close: () => Promise<void>;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(claims)}.c2ln`;
}

function basicClientId(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  return decoded.slice(0, Math.max(decoded.indexOf(':'), 0));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeServer(): Promise<FakeServer> {
  const fake: FakeServer = {
    issuer: '',
    claims: {},
    tokenError: undefined,
    expiresIn: 900,
    issueRefreshToken: true,
    refreshDelayMs: 0,
    tokenRequests: [],
    tokenAuthorizations: [],
    spentRefreshTokens: new Set(),
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '';
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (path.endsWith('/.well-known/openid-configuration')) {
      send(200, {
        issuer: fake.issuer,
        authorization_endpoint: `${fake.issuer}/authorize`,
        token_endpoint: `${fake.issuer}/token`,
        jwks_uri: `${fake.issuer}/jwks`,
        end_session_endpoint: `${fake.issuer}/logout`,
        authorization_response_iss_parameter_supported: true,
        id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      });
      return;
    }
    if (!path.endsWith('/token') || request.method !== 'POST') {
      send(404, { error: 'not_found' });
      return;
    }
    readBody(request).then(
      (raw) => {
        const form = new URLSearchParams(raw);
        fake.tokenRequests.push(form);
        fake.tokenAuthorizations.push(request.headers.authorization);
        const refreshing = form.get('grant_type') === 'refresh_token';
        const answer = (): void => {
          if (fake.tokenError !== undefined) {
            send(400, fake.tokenError);
            return;
          }
          const presented = form.get('refresh_token') ?? '';
          if (refreshing && fake.spentRefreshTokens.has(presented)) {
            send(400, { error: 'invalid_grant', error_description: 'reuse detected' });
            return;
          }
          if (refreshing) fake.spentRefreshTokens.add(presented);
          const now = Math.floor(Date.now() / 1000);
          send(200, {
            access_token: `access-token-${String(fake.tokenRequests.length)}`,
            token_type: 'Bearer',
            expires_in: fake.expiresIn,
            scope: 'openid offline_access',
            ...(fake.issueRefreshToken
              ? { refresh_token: refreshing ? `${presented}-rotated` : 'refresh-token-1' }
              : {}),
            id_token: idToken({
              iss: fake.issuer,
              sub: 'subject-1',
              aud: form.get('client_id') ?? basicClientId(request.headers.authorization),
              iat: now,
              exp: now + 300,
              ...fake.claims,
            }),
          });
        };
        if (refreshing && fake.refreshDelayMs > 0) setTimeout(answer, fake.refreshDelayMs);
        else answer();
      },
      () => {
        send(500, { error: 'server_error' });
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.issuer = `http://127.0.0.1:${String(port)}/tenants/demo`;
  fake.close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  return fake;
}
