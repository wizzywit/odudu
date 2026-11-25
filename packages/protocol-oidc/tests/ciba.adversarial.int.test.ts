import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { FakeClock } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { CIBA_GRANT, hashAuthReqId } from '#/service/ciba';
import { CIBA_KEK, seedCibaWorld, type CibaWorld } from '#/testing/ciba-fixture';
import { noBreachedLookup } from '#/testing/breached-check';
import { decideApproval } from '#/usecase/approvals';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let world: CibaWorld;
const clock = new FakeClock(new Date());
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const isMethod = (method: string): method is Method => METHODS.includes(method);
const routes: { method: Method; url: string }[] = [];

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
  http = Fastify();
  http.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (isMethod(method)) routes.push({ method, url: route.url });
    }
  });
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: CIBA_KEK,
      clock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  world = await seedCibaWorld(app, 'adversarial');
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

const basic = (): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`${world.agent.clientId}:${world.agent.secret}`).toString('base64')}`,
});

async function pendingRequest() {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...basic() },
    payload: 'scope=openid&login_hint=alice',
  });
  expect(res.statusCode).toBe(200);
  const authReqId = res.json<{ auth_req_id: string }>().auth_req_id;
  const row = await withTenant(app.db, world.tenantId, (tx) =>
    cibaRequestRepository(tx).byHash(hashAuthReqId(authReqId)),
  );
  return { authReqId, approvalId: row?.approvalId ?? '' };
}

async function stateOf(approvalId: string): Promise<string | undefined> {
  const rows = await owner.db.execute<{ state: string }>(
    sql`select state from agent_approvals where id = ${approvalId}`,
  );
  return rows[0]?.state;
}

describe('a client that asked for an approval', () => {
  it('[OIDC-CIBA-8-02] cannot move it out of pending through any route it can reach', async () => {
    const { authReqId, approvalId } = await pendingRequest();
    const tried = new Set<string>();
    const forged = new URLSearchParams({
      approval_id: approvalId,
      auth_req_id: authReqId,
      approve: 'true',
      approved: 'true',
      decision: 'approve',
      state: 'approved',
      subject_id: world.alice.subjectId,
      via: 'ciba_page',
    }).toString();

    for (const route of routes) {
      const url = route.url
        .replace(':tenant', world.tenant)
        .replace(/:[A-Za-z_]+/gu, approvalId)
        .replace(/\*/gu, 'x');
      const key = `${route.method} ${url}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const withBody = route.method !== 'GET' && route.method !== 'DELETE';
      await http.inject({
        method: route.method,
        url: withBody ? url : `${url}?${forged}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...basic() },
        ...(withBody ? { payload: forged } : {}),
      });
    }
    expect(tried.size).toBeGreaterThan(10);

    // The token endpoint under every grant a confidential client may name.
    for (const grant of [CIBA_GRANT, 'client_credentials', 'authorization_code', 'refresh_token']) {
      await http.inject({
        method: 'POST',
        url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...basic() },
        payload: `${forged}&grant_type=${encodeURIComponent(grant)}`,
      });
    }

    expect(await stateOf(approvalId)).toBe('pending');
    await withTenant(app.db, world.tenantId, async (tx) => {
      const rows = await auditRepository(tx).list({ limit: 500 });
      expect(rows.some((row) => row.action === 'agent.approval_decided')).toBe(false);
    });
    const poll = await http.inject({
      method: 'POST',
      url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...basic() },
      payload: `grant_type=${encodeURIComponent(CIBA_GRANT)}&auth_req_id=${authReqId}`,
    });
    expect(poll.statusCode).toBe(400);
    expect(['authorization_pending', 'slow_down']).toContain(poll.json<{ error: string }>().error);
  });

  it('cannot use another person to decide: only the owner moves an approval', async () => {
    const { approvalId } = await pendingRequest();
    const outcome = await withTenant(app.db, world.tenantId, (tx) =>
      decideApproval(
        tx,
        { tenantId: world.tenantId },
        {
          approvalId,
          subjectId: world.bob.subjectId,
          approve: true,
          via: 'ciba_page',
          now: clock.now(),
        },
      ),
    );
    expect(outcome).toBe('not_owner');
    expect(await stateOf(approvalId)).toBe('pending');
  });

  it('cannot redeem an approval it was handed by the person for a different request', async () => {
    const first = await pendingRequest();
    const second = await pendingRequest();
    await withTenant(app.db, world.tenantId, (tx) =>
      decideApproval(
        tx,
        { tenantId: world.tenantId },
        {
          approvalId: first.approvalId,
          subjectId: world.alice.subjectId,
          approve: true,
          via: 'ciba_page',
          now: clock.now(),
        },
      ),
    );
    clock.advance(6000);
    const poll = (authReqId: string) =>
      http.inject({
        method: 'POST',
        url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...basic() },
        payload: `grant_type=${encodeURIComponent(CIBA_GRANT)}&auth_req_id=${authReqId}`,
      });
    expect((await poll(second.authReqId)).json()).toMatchObject({ error: 'authorization_pending' });
    expect((await poll(first.authReqId)).statusCode).toBe(200);
  });
});
