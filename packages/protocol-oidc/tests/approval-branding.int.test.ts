import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { FakeClock, type BrandingScope, type PageBranding } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { hashAuthReqId } from '#/service/ciba';
import { noBreachedLookup } from '#/testing/breached-check';
import { seedCibaWorld, CIBA_KEK, type CibaWorld } from '#/testing/ciba-fixture';
import { signedInCookie } from '#/testing/signed-in-cookie';

// A tenant's theme reaches the approval page: its tokens and stylesheet through
// the shell, its template for the page's own kind, and nothing but the tenant's
// own theme, because a mailed link names no client.

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
const clock = new FakeClock(new Date());
const asked: BrandingScope[] = [];

const THEME: PageBranding = {
  branding: {
    origin: 'https://id.example.test',
    templates: {
      approval:
        '<div class="t-theme">{{submit.deny}}{{form.open}}{{submit.approve}}{{form.close}}{{details}}</div>',
    },
    tokensCss: ':root{--surface-page:#fff4e0}',
    stylesheetUrl: '/theme.css',
    faviconUrl: null,
    logo: null,
    assetUrls: [],
  },
  templateFallback: () => undefined,
  mail: null,
};

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
      clientSecretLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      cibaLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
      resolveBranding: (scope) => {
        asked.push(scope);
        return Promise.resolve(THEME);
      },
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

async function openFor(world: CibaWorld): Promise<string> {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${world.agent.clientId}:${world.agent.secret}`).toString('base64')}`,
    },
    payload: 'scope=openid&login_hint=alice',
  });
  const authReqId = res.json<{ auth_req_id: string }>().auth_req_id;
  const row = await withTenant(app.db, world.tenantId, (tx) =>
    cibaRequestRepository(tx).byHash(hashAuthReqId(authReqId)),
  );
  return row?.approvalId ?? '';
}

describe('the approval page of a themed tenant', () => {
  it('[ODUDU-APPROVAL-THEME-01] wears the tenant theme: its stylesheet, its template and its page hook', async () => {
    const world = await seedCibaWorld(app, 'theme');
    const cookie = await signedInCookie(app, world, world.alice.subjectId, clock.now());
    const id = await openFor(world);
    asked.length = 0;
    const res = await http.inject({
      method: 'GET',
      url: `/tenants/${world.tenant}/approval/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="/theme.css"');
    expect(res.body).toContain('class="t-theme"');
    expect(res.body).toContain('class="page page-approval"');
    const parts = ['value="deny"', '<form', 'value="approve"', '</form>', 'class="intro"'];
    const at = parts.map((part) => res.body.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('[ODUDU-APPROVAL-THEME-02] keeps the form, its token and both buttons whatever the template places, and asks for no client theme', async () => {
    const world = await seedCibaWorld(app, 'theme-form');
    const cookie = await signedInCookie(app, world, world.alice.subjectId, clock.now());
    const id = await openFor(world);
    asked.length = 0;
    const res = await http.inject({
      method: 'GET',
      url: `/tenants/${world.tenant}/approval/${id}`,
      headers: { cookie },
    });
    expect(res.body.match(/type="hidden" name="csrf"/gu)).toHaveLength(1);
    expect(res.body.match(/name="decision"/gu)).toHaveLength(2);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((scope) => scope.clientId === null)).toBe(true);
  });

  it('[ODUDU-APPROVAL-THEME-03] wears the tenant theme on the page that answers a decision and on the generic one', async () => {
    const world = await seedCibaWorld(app, 'theme-ends');
    const cookie = await signedInCookie(app, world, world.alice.subjectId, clock.now());
    const missing = await http.inject({
      method: 'GET',
      url: `/tenants/${world.tenant}/approval/00000000-0000-4000-8000-000000000000`,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain('href="/theme.css"');
    expect(missing.body).toContain('class="page page-logged-out"');
  });
});
