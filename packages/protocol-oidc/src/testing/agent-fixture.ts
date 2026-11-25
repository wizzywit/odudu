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
import { sql } from 'drizzle-orm';
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

// Runs every closer, the first to the last, even when one throws, and rethrows
// the first failure.
async function stopAll(closers: readonly (() => Promise<unknown>)[]): Promise<void> {
  const [first, ...rest] = closers;
  if (first === undefined) return;
  try {
    await first();
  } finally {
    await stopAll(rest);
  }
}

export async function startAgentStack(
  options: { claimMappers?: ClaimMapperRegistry<ClaimContext> } = {},
): Promise<AgentStack> {
  // Newest first, so a failed setup stops what it acquired in reverse.
  const closers: (() => Promise<unknown>)[] = [];
  try {
    return await buildStack(options, closers);
  } catch (error) {
    await stopAll(closers).catch(() => undefined);
    throw error;
  }
}

async function buildStack(
  options: { claimMappers?: ClaimMapperRegistry<ClaimContext> },
  closers: (() => Promise<unknown>)[],
): Promise<AgentStack> {
  const container: TestDatabase = await startTestDatabase();
  closers.unshift(() => container.stop());
  const owner = createDatabase(container.adminUrl);
  closers.unshift(() => owner.close());
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
  closers.unshift(() => app.close());
  const clock = new FakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  const http = Fastify();
  closers.unshift(() => http.close());
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
    stop: () => stopAll(closers),
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

// Returns once `waiting` backends are blocked, directly or behind one another,
// by the transaction of backend `holder`: the test's own, whatever else the
// database is doing.
export async function waitForLockWaiters(
  owner: DatabaseHandle,
  holder: number,
  waiting = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await owner.db.execute(
      sql`with recursive blocked(pid) as (
            select ${holder}::int
            union
            select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
          )
          select count(*)::int - 1 as n from blocked`,
    );
    if (Number((rows as unknown as { n: number }[])[0]?.n) >= waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${String(waiting)} backends waited on the held lock`);
}

export interface HeldLock {
  // Lets the holding transaction go on (to `afterRelease`) and commit.
  release: () => void;
  // Settles when the holding transaction has committed or failed.
  done: Promise<void>;
  // Waits until `waiting` backends are blocked behind the holding transaction.
  waitForWaiters: (owner: DatabaseHandle, waiting?: number) => Promise<void>;
  // Registers an operation the body started, so it is awaited however the body ends.
  started: <T>(operation: Promise<T>) => Promise<T>;
}

// Runs `body` while a transaction of the test holds the rows `lock` takes. The
// body starts only once the lock is held, and not at all if taking it fails.
// However the body ends, the holder is released and every operation it started
// has settled before this returns, so a failure leaves nothing open; a failure
// of the holder after it was released is thrown.
export async function withHeldLock<R>(
  db: DatabaseHandle['db'],
  tenantId: string,
  hold: {
    lock: (tx: TenantScopedDatabase) => Promise<void>;
    afterRelease?: (tx: TenantScopedDatabase) => Promise<void>;
  },
  body: (held: HeldLock) => Promise<R>,
): Promise<R> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const gotLock = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let pid = 0;
  const done = withTenant(db, tenantId, async (tx) => {
    await hold.lock(tx);
    const own = await tx.execute(sql`select pg_backend_pid()::int as pid`);
    pid = Number((own as unknown as { pid: number }[])[0]?.pid);
    locked();
    await released;
    await hold.afterRelease?.(tx);
  });
  const pending: Promise<unknown>[] = [done];
  try {
    await Promise.race([gotLock, done]);
    const result = await body({
      release,
      done,
      waitForWaiters: (owner, waiting = 1) => waitForLockWaiters(owner, pid, waiting),
      started: (operation) => {
        pending.push(operation);
        return operation;
      },
    });
    release();
    await done;
    return result;
  } finally {
    release();
    await Promise.allSettled(pending);
  }
}
