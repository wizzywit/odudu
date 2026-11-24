import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
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
import { hashAuthReqId } from '#/service/ciba';
import { noBreachedLookup } from '#/testing/breached-check';
import { seedCibaWorld, CIBA_KEK, type CibaWorld } from '#/testing/ciba-fixture';
import { requestApproval } from '#/usecase/approvals';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let world: CibaWorld;
const clock = new FakeClock(new Date());
const BASE = 'https://idp.example';
const budget = { asked: [] as string[], open: true };

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: CIBA_KEK,
      clock,
      publicBaseUrl: BASE,
      approvalMailBudget: (_tenantId, address) => {
        budget.asked.push(address);
        return budget.open;
      },
      clientSecretLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      cibaLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    }),
  );
  await http.ready();
  world = await seedCibaWorld(app, 'notice');
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

async function ask(hint: string, extra: Record<string, string> = {}) {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${world.agent.clientId}:${world.agent.secret}`).toString('base64')}`,
    },
    payload: new URLSearchParams({ scope: 'openid', login_hint: hint, ...extra }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ auth_req_id: string }>().auth_req_id;
}

function mail() {
  return owner.db.execute<{
    to_address: string;
    subject: string;
    body_text: string;
    body_html: string;
  }>(
    sql`select to_address, subject, body_text, body_html from email_outbox where tenant_id = ${world.tenantId} order by created_at`,
  );
}

describe('the mail a CIBA request sends', () => {
  it('[ODUDU-CIBA-NOTICE-01] queues one mail per real approval, with its link and nothing that acts', async () => {
    const before = (await mail()).length;
    const authReqId = await ask('alice');
    const row = await withTenant(app.db, world.tenantId, (tx) =>
      cibaRequestRepository(tx).byHash(hashAuthReqId(authReqId)),
    );
    const sent = (await mail()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to_address).toBe(world.alice.email);
    const link = `${BASE}/tenants/${world.tenant}/approval/${row?.approvalId ?? ''}`;
    expect(sent[0]?.body_text).toContain(link);
    expect(sent[0]?.body_html).toContain(link);
    expect(sent[0]?.body_text).toContain('Client agent');
    const everything = `${sent[0]?.subject ?? ''}${sent[0]?.body_text ?? ''}${sent[0]?.body_html ?? ''}`;
    expect(everything).not.toContain(authReqId);
    expect(everything).not.toContain(world.agent.secret);
    const links = everything.match(/https?:\/\/[^\s"<]+/gu) ?? [];
    expect(new Set(links)).toEqual(new Set([link]));
  });

  it('[ODUDU-CIBA-NOTICE-02] queues nothing for a person who does not exist, or whose address is unverified or absent', async () => {
    const before = (await mail()).length;
    await ask('nobody-by-that-name');
    await ask('bob');
    expect((await mail()).length).toBe(before);
  });

  it('[ODUDU-CIBA-NOTICE-03] queues nothing for a person at the pending limit', async () => {
    const full = await seedCibaWorld(app, 'notice-cap');
    for (let i = 0; i < 20; i += 1) {
      await withTenant(app.db, full.tenantId, (tx) =>
        requestApproval(
          tx,
          { tenantId: full.tenantId },
          {
            subjectId: full.alice.subjectId,
            requestingClientId: full.other.dbId,
            instanceId: null,
            kind: 'tool_call',
            summary: 'Something else',
            actionDigest: 'b'.repeat(64),
            now: clock.now(),
          },
        ),
      );
    }
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${full.tenant}/protocol/openid-connect/bc-authorize`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${full.agent.clientId}:${full.agent.secret}`).toString('base64')}`,
      },
      payload: 'scope=openid&login_hint=alice',
    });
    expect(res.statusCode).toBe(200);
    const queued = await owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from email_outbox where tenant_id = ${full.tenantId}`,
    );
    expect(queued[0]?.n).toBe(0);
  });

  it('[ODUDU-CIBA-NOTICE-04] asks the address budget for a mailable address only, and queues nothing over it, though the request succeeds', async () => {
    budget.asked.length = 0;
    await ask('nobody-by-that-name');
    await ask('bob');
    expect(budget.asked).toEqual([]);

    budget.open = false;
    try {
      const before = (await mail()).length;
      const authReqId = await ask('alice');
      expect(authReqId).toBeTruthy();
      expect(budget.asked).toEqual([world.alice.email]);
      expect((await mail()).length).toBe(before);
    } finally {
      budget.open = true;
    }
  });
});
