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
  // Answers `tokenError` as Odudu does for a refused client: 401 with a Basic
  // challenge. With `tokenError` unset the 401 has no body.
  tokenChallenge: boolean;
  // The raw body of the challenge answer, instead of `tokenError`: bytes, or
  // `endless` for a body that is never finished.
  tokenChallengeBody: Buffer | 'endless' | undefined;
  // Answers every token request with this status and body, as a proxy in
  // front of the server does: an HTML page, or nothing at all.
  tokenRaw: { status: number; contentType?: string; body: string } | undefined;
  // Omitted from the token response when undefined.
  scope: string | undefined;
  // Omitted from the token response when undefined.
  expiresIn: number | string | undefined;
  tokenRequests: URLSearchParams[];
  // The `authorization` header of each token request, in the same order.
  tokenAuthorizations: (string | undefined)[];
  clientCredentialsGrants: number;
  // Refresh tokens already presented; a second use is refused as Odudu does.
  spentRefreshTokens: Set<string>;
  // Presenting a spent refresh token revokes the whole family: every refresh
  // after it is refused, however fresh its token.
  reuseDetections: number;
  // A refresh asking for this `resource` is refused with invalid_target before
  // its token is spent.
  refusedResource: string | undefined;
  // Leaves the ID token out of a refresh response.
  omitIdTokenOnRefresh: boolean;
  // Hangs up on a refresh after the server has spent its token, as a lost
  // connection does.
  dropAfterSpend: boolean;
  // Makes the access token of a refresh a JWT whose `aud` is this list; an
  // opaque string when unset.
  refreshedAudience: string[] | undefined;
  // Milliseconds every token endpoint answer is held, to overlap requests.
  tokenDelayMs: number;
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

function basicClientId(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  // The user name is form-encoded (RFC 6749 section 2.3.1).
  return (
    new URLSearchParams(`v=${decoded.slice(0, Math.max(decoded.indexOf(':'), 0))}`).get('v') ??
    undefined
  );
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
    tokenChallenge: false,
    tokenChallengeBody: undefined,
    tokenRaw: undefined,
    scope: 'openid',
    expiresIn: 900,
    tokenRequests: [],
    tokenAuthorizations: [],
    clientCredentialsGrants: 0,
    spentRefreshTokens: new Set(),
    reuseDetections: 0,
    refusedResource: undefined,
    tokenDelayMs: 0,
    omitIdTokenOnRefresh: false,
    dropAfterSpend: false,
    refreshedAudience: undefined,
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
        async (raw) => {
          const form = new URLSearchParams(raw);
          fake.tokenRequests.push(form);
          fake.tokenAuthorizations.push(request.headers.authorization);
          if (fake.tokenDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, fake.tokenDelayMs));
          }
          if (fake.tokenRaw !== undefined) {
            response.writeHead(
              fake.tokenRaw.status,
              fake.tokenRaw.contentType === undefined
                ? {}
                : { 'content-type': fake.tokenRaw.contentType },
            );
            response.end(fake.tokenRaw.body);
            return;
          }
          if (fake.tokenChallenge) {
            response.writeHead(401, {
              'content-type': 'application/json',
              'www-authenticate': 'Basic realm="token"',
            });
            if (fake.tokenChallengeBody === 'endless') {
              const timer = setInterval(() => response.write('x'.repeat(1024)), 1);
              response.on('close', () => {
                clearInterval(timer);
              });
              return;
            }
            response.end(
              fake.tokenChallengeBody ??
                (fake.tokenError === undefined ? '' : JSON.stringify(fake.tokenError)),
            );
            return;
          }
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
            if (
              fake.refusedResource !== undefined &&
              form.get('resource') === fake.refusedResource
            ) {
              send(400, { error: 'invalid_target' });
              return;
            }
            if (fake.reuseDetections > 0) {
              send(400, { error: 'invalid_grant', error_description: 'family revoked' });
              return;
            }
            if (fake.spentRefreshTokens.has(presented)) {
              fake.reuseDetections += 1;
              send(400, { error: 'invalid_grant', error_description: 'reuse detected' });
              return;
            }
            fake.spentRefreshTokens.add(presented);
            if (fake.dropAfterSpend) {
              response.destroy();
              return;
            }
          }
          const now = Math.floor(Date.now() / 1000);
          send(200, {
            access_token:
              form.get('grant_type') === 'refresh_token' && fake.refreshedAudience !== undefined
                ? `${base64url({ alg: 'ES256', typ: 'at+jwt' })}.${base64url({ aud: fake.refreshedAudience })}.c2ln`
                : 'access-token-1',
            token_type: 'Bearer',
            ...(fake.expiresIn === undefined ? {} : { expires_in: fake.expiresIn }),
            ...(fake.scope === undefined ? {} : { scope: fake.scope }),
            refresh_token:
              form.get('grant_type') === 'refresh_token'
                ? `${form.get('refresh_token') ?? ''}-rotated`
                : 'refresh-token-1',
            ...(form.get('grant_type') === 'refresh_token' && fake.omitIdTokenOnRefresh
              ? {}
              : {
                  id_token: idToken({
                    iss: fake.issuer,
                    sub: 'subject-1',
                    aud: form.get('client_id') ?? basicClientId(request.headers.authorization),
                    iat: now,
                    exp: now + 300,
                    ...fake.claims,
                  }),
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
