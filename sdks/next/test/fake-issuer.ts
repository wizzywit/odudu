import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeIssuer {
  issuer: string;
  // Merged over the claims of every ID token the token endpoint mints.
  claims: Record<string, unknown>;
  expiresIn: number;
  issueRefreshToken: boolean;
  // How many times the token endpoint was called.
  tokenRequests: number;
  close: () => Promise<void>;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// A just enough OpenID provider for the BFF's code exchange: discovery and a
// token endpoint that mints an unsigned-looking ID token. The BFF does not
// verify its signature (the token comes straight from the issuer over TLS).
export async function startFakeIssuer(): Promise<FakeIssuer> {
  const fake: FakeIssuer = {
    issuer: '',
    claims: {},
    expiresIn: 900,
    issueRefreshToken: true,
    tokenRequests: 0,
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
    fake.tokenRequests += 1;
    request.resume();
    request.on('end', () => {
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        base64url({ alg: 'RS256', typ: 'JWT' }),
        base64url({
          iss: fake.issuer,
          sub: 'subject-1',
          aud: 'web1',
          iat: now,
          exp: now + 300,
          ...fake.claims,
        }),
        'c2ln',
      ].join('.');
      send(200, {
        access_token: 'access-token-secret-1',
        token_type: 'Bearer',
        expires_in: fake.expiresIn,
        scope: 'openid offline_access',
        ...(fake.issueRefreshToken ? { refresh_token: 'refresh-token-secret-1' } : {}),
        id_token: idToken,
      });
    });
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
