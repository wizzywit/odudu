import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { type ClaimMapperRegistry, FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { type ClaimContext } from '#/service/claims';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import { noBreachedLookup } from '#/testing/breached-check';

export const KEK = Buffer.alloc(32, 29);
export const REDIRECT_URI = 'https://app.example/callback';
export const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export interface AgentStack {
  http: FastifyInstance;
  app: DatabaseHandle;
  owner: DatabaseHandle;
  clock: FakeClock;
  tenantName: string;
  tenantId: string;
  stop: () => Promise<void>;
}

export async function startAgentStack(
  options: { claimMappers?: ClaimMapperRegistry<ClaimContext> } = {},
): Promise<AgentStack> {
  const container: TestDatabase = await startTestDatabase();
  const owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
  const clock = new FakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  const http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      ...(options.claimMappers === undefined ? {} : { claimMappers: options.claimMappers }),
    }),
  );
  await http.ready();

  const tenantName = `agent-${newId()}`;
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenantName });
    await provisionTenant(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });

  return {
    http,
    app,
    owner,
    clock,
    tenantName,
    tenantId,
    stop: async () => {
      await http.close();
      await app.close();
      await owner.close();
      await container.stop();
    },
  };
}

export interface NewClient {
  clientId: string;
  agentType?: boolean;
  delegatedActors?: string[];
  impersonation?: boolean;
}

export const secretOf = (clientId: string): string => `${clientId}-secret`;

export async function addClient(stack: AgentStack, input: NewClient): Promise<string> {
  const dbId = newId();
  await withTenant(stack.app.db, stack.tenantId, async (tx) => {
    await tx.insert(clients).values({
      id: dbId,
      tenantId: stack.tenantId,
      clientId: input.clientId,
      name: input.clientId,
      type: 'confidential',
      secretHash: await hashPassword(secretOf(input.clientId)),
    });
    await provisionClientDefaults(tx, dbId);
    await clientOidcConfigRepository(tx).create({
      clientId: dbId,
      tenantId: stack.tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE_GRANT],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: ['https://api.example'],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      tokenExchangeImpersonationAllowed: input.impersonation ?? false,
      agentType: input.agentType ?? false,
      delegatedActors: input.delegatedActors ?? [],
    });
  });
  return dbId;
}

export const basic = (clientId: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secretOf(clientId)}`).toString('base64')}`;

export function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export interface Login {
  accessToken: string;
  refreshToken: string;
  grantId: string;
  subjectId: string;
}

function cookieOf(res: LightMyRequestResponse): void {
  if (res.statusCode !== 302)
    throw new Error(`expected a successful login, got ${String(res.statusCode)}`);
}

// Signs the one user in through `clientId` and redeems the code.
export async function login(stack: AgentStack, clientId: string, scope = 'openid'): Promise<Login> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const base = `/tenants/${stack.tenantName}`;
  const authorize = await stack.http.inject({
    url: `${base}/protocol/openid-connect/auth?${params.toString()}`,
  });
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body)?.[1];
  if (authSessionId === undefined) throw new Error('no login form');
  const submitted = await stack.http.inject({
    method: 'POST',
    url: `${base}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  cookieOf(submitted);
  const location = submitted.headers.location;
  if (typeof location !== 'string') throw new Error('no redirect');
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error('no code');
  const redeemed = await stack.http.inject({
    method: 'POST',
    url: `${base}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(clientId),
    },
  });
  if (redeemed.statusCode !== 200) throw new Error(`redeem failed: ${redeemed.body}`);
  const body = redeemed.json<{ access_token: string; refresh_token: string }>();
  const claims = decode(body.access_token);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    grantId: String(claims.grant_id),
    subjectId: String(claims.sub),
  };
}

const ACCESS = 'urn:ietf:params:oauth:token-type:access_token';
const REFRESH = 'urn:ietf:params:oauth:token-type:refresh_token';

export function exchange(
  stack: AgentStack,
  clientId: string,
  subjectToken: string,
  options: { type?: 'access' | 'refresh'; scope?: string; extra?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: subjectToken,
    subject_token_type: options.type === 'refresh' ? REFRESH : ACCESS,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...options.extra,
  });
  return stack.http.inject({
    method: 'POST',
    url: `/tenants/${stack.tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(clientId),
    },
  });
}
