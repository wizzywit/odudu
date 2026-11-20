import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeServer {
  issuer: string;
  // What the discovery document says the issuer is; differs from `issuer`
  // to stand for a server answering for someone else.
  metadataIssuer: string | undefined;
  // Claims merged over the defaults of every ID token the token endpoint mints.
  claims: Record<string, unknown>;
  // A refusal the token endpoint answers with instead of tokens.
  tokenError: { error: string; error_description?: string } | undefined;
  // Omitted from the token response when undefined.
  scope: string | undefined;
  // Omitted from the token response when undefined.
  expiresIn: number | undefined;
  tokenRequests: URLSearchParams[];
  // The `authorization` header of each token request, in the same order.
  tokenAuthorizations: (string | undefined)[];
  clientCredentialsGrants: number;
  // Refresh tokens already presented; a second use is refused as Odudu does.
  spentRefreshTokens: Set<string>;
  discoveryRequests: number;
  close: () => Promise<void>;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// The core does not check an ID token's signature (the code flow receives it
// straight from the token endpoint over TLS), so the signature is a stub.
function idToken(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(claims)}.c2ln`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeServer(tenant = 'demo'): Promise<FakeServer> {
  const fake: FakeServer = {
    issuer: '',
    metadataIssuer: undefined,
    claims: {},
    tokenError: undefined,
    scope: 'openid',
    expiresIn: 900,
    tokenRequests: [],
    tokenAuthorizations: [],
    clientCredentialsGrants: 0,
    spentRefreshTokens: new Set(),
    discoveryRequests: 0,
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '';
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (path.endsWith('/.well-known/openid-configuration')) {
      fake.discoveryRequests += 1;
      send(200, {
        issuer: fake.metadataIssuer ?? fake.issuer,
        authorization_endpoint: `${fake.issuer}/authorize`,
        token_endpoint: `${fake.issuer}/token`,
        jwks_uri: `${fake.issuer}/jwks`,
        end_session_endpoint: `${fake.issuer}/logout`,
        authorization_response_iss_parameter_supported: true,
        id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      });
      return;
    }
    if (path.endsWith('/token') && request.method === 'POST') {
      readBody(request).then(
        (raw) => {
          const form = new URLSearchParams(raw);
          fake.tokenRequests.push(form);
          fake.tokenAuthorizations.push(request.headers.authorization);
          if (fake.tokenError !== undefined) {
            send(400, fake.tokenError);
            return;
          }
          if (form.get('grant_type') === 'client_credentials') {
            fake.clientCredentialsGrants += 1;
            send(200, {
              access_token: `client-token-${String(fake.clientCredentialsGrants)}`,
              token_type: 'Bearer',
              ...(fake.expiresIn === undefined ? {} : { expires_in: fake.expiresIn }),
              ...(fake.scope === undefined ? {} : { scope: fake.scope }),
            });
            return;
          }
          const presented = form.get('refresh_token');
          if (form.get('grant_type') === 'refresh_token' && presented !== null) {
            if (fake.spentRefreshTokens.has(presented)) {
              send(400, { error: 'invalid_grant', error_description: 'reuse detected' });
              return;
            }
            fake.spentRefreshTokens.add(presented);
          }
          const now = Math.floor(Date.now() / 1000);
          send(200, {
            access_token: 'access-token-1',
            token_type: 'Bearer',
            ...(fake.expiresIn === undefined ? {} : { expires_in: fake.expiresIn }),
            ...(fake.scope === undefined ? {} : { scope: fake.scope }),
            refresh_token:
              form.get('grant_type') === 'refresh_token'
                ? `${form.get('refresh_token') ?? ''}-rotated`
                : 'refresh-token-1',
            id_token: idToken({
              iss: fake.issuer,
              sub: 'subject-1',
              aud: form.get('client_id'),
              iat: now,
              exp: now + 300,
              ...fake.claims,
            }),
          });
        },
        () => {
          send(500, { error: 'server_error' });
        },
      );
      return;
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.issuer = `http://127.0.0.1:${String(port)}/tenants/${tenant}`;
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
