import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeIssuer {
  issuer: string;
  // Claims merged over the defaults of every ID token the token endpoint mints.
  claims: Record<string, unknown>;
  expiresIn: number;
  tokenRequests: URLSearchParams[];
  close: () => Promise<void>;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// The core does not check an ID token's signature (the code flow receives it
// straight from the token endpoint), so the signature is a stub.
function idToken(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(claims)}.c2ln`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeIssuer(): Promise<FakeIssuer> {
  const fake: FakeIssuer = {
    issuer: '',
    claims: {},
    expiresIn: 900,
    tokenRequests: [],
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
    if (path.endsWith('/token') && request.method === 'POST') {
      readBody(request).then(
        (raw) => {
          const form = new URLSearchParams(raw);
          fake.tokenRequests.push(form);
          const now = Math.floor(Date.now() / 1000);
          const refreshing = form.get('grant_type') === 'refresh_token';
          send(200, {
            access_token: refreshing ? 'access-token-2' : 'access-token-1',
            token_type: 'Bearer',
            expires_in: fake.expiresIn,
            scope: 'openid',
            refresh_token: refreshing
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
