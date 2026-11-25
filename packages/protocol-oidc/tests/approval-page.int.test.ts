import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { SessionEntry } from '@odudu/authn-flows';
import { FakeClock } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { CIBA_GRANT, hashAuthReqId } from '#/service/ciba';
import { noBreachedLookup } from '#/testing/breached-check';
import { seedCibaWorld, CIBA_KEK, type CibaClient, type CibaWorld } from '#/testing/ciba-fixture';
import { signedInCookie } from '#/testing/signed-in-cookie';
import { requestApproval } from '#/usecase/approvals';
import { APPROVAL_DECISION } from '#/usecase/approval-page';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
const clock = new FakeClock(new Date());

const HOSTILE = `<script>alert(1)</script> "q" & '</script>`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

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
      approvalSignIn: (tenant, back) =>
        `https://signin.test/login?tenant=${tenant}&return_to=${encodeURIComponent(back)}`,
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

function basic(client: CibaClient): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`,
  };
}

function form(params: Record<string, string | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) out.set(key, value);
  return out.toString();
}

interface Opened {
  readonly authReqId: string;
  readonly approvalId: string;
  readonly path: string;
}

async function open(world: CibaWorld, params: Record<string, string> = {}): Promise<Opened> {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/bc-authorize`,
    headers: { ...FORM, ...basic(world.agent) },
    payload: form({ scope: 'openid', login_hint: 'alice', ...params }),
  });
  expect(res.statusCode, res.body).toBe(200);
  const authReqId = res.json<{ auth_req_id: string }>().auth_req_id;
  const row = await withTenant(app.db, world.tenantId, (tx) =>
    cibaRequestRepository(tx).byHash(hashAuthReqId(authReqId)),
  );
  const approvalId = row?.approvalId;
  if (approvalId === null || approvalId === undefined) throw new Error('no approval was made');
  return { authReqId, approvalId, path: `/tenants/${world.tenant}/approval/${approvalId}` };
}

function get(path: string, cookie?: string): Promise<LightMyRequestResponse> {
  return http.inject({ method: 'GET', url: path, headers: cookie === undefined ? {} : { cookie } });
}

function post(
  path: string,
  fields: Record<string, string | undefined>,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: path,
    headers: { ...FORM, ...(cookie === undefined ? {} : { cookie }) },
    payload: form(fields),
  });
}

function csrfOf(res: LightMyRequestResponse): string {
  const value = /name="csrf" value="([^"]+)"/u.exec(res.body)?.[1];
  if (value === undefined) throw new Error(`no csrf field in: ${res.body}`);
  return value;
}

function poll(world: CibaWorld, authReqId: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${world.tenant}/protocol/openid-connect/token`,
    headers: { ...FORM, ...basic(world.agent) },
    payload: form({ grant_type: CIBA_GRANT, auth_req_id: authReqId }),
  });
}

function stateOf(approvalId: string) {
  return owner.db.execute<{ state: string; decided_via: string | null }>(
    sql`select state, decided_via from agent_approvals where id = ${approvalId}`,
  );
}

let world: CibaWorld;
let MISSING: string;
let aliceCookie: string;
let bobCookie: string;
beforeAll(async () => {
  world = await seedCibaWorld(app, 'page');
  MISSING = `/tenants/${world.tenant}/approval/00000000-0000-4000-8000-000000000000`;
  aliceCookie = await signedInCookie(app, world, world.alice.subjectId, clock.now());
  bobCookie = await signedInCookie(app, world, world.bob.subjectId, clock.now());
});

describe('the approval page', () => {
  it('[ODUDU-APPROVAL-PAGE-01] sends a person with no session to sign in and names this page as the way back', async () => {
    const opened = await open(world);
    const res = await get(opened.path);
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.origin).toBe('https://signin.test');
    expect(location.searchParams.get('return_to')).toBe(opened.path);
    expect(res.body).not.toContain(opened.approvalId);
  });

  it('[ODUDU-APPROVAL-PAGE-02] shows the owner the agent, the request, the message and the expiry', async () => {
    const opened = await open(world, { binding_message: 'Pay invoice 42' });
    const res = await get(opened.path, aliceCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Client agent');
    expect(res.body).toContain('asks to sign in as you with: <bdi>openid</bdi>');
    expect(res.body).toContain('Pay invoice 42');
    expect(res.body).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/u);
    expect(res.body).toContain('value="approve"');
    expect(res.body).toContain('value="deny"');
    expect(res.headers['content-type']).toMatch(/^text\/html/u);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).not.toContain('script-src');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('[ODUDU-APPROVAL-PAGE-02b] names the tenant by its display name, escaped', async () => {
    await owner.db.execute(
      sql`update tenants set display_name = 'Pages & Co <Ltd>' where id = ${world.tenantId}`,
    );
    const opened = await open(world);
    const res = await get(opened.path, aliceCookie);
    expect(res.body).toContain('Pages &amp; Co &lt;Ltd&gt;');
    expect(res.body).not.toContain(`<bdi>${world.tenant}</bdi>`);
  });

  it('[ODUDU-APPROVAL-PAGE-03] escapes a message with markup once and carries no script', async () => {
    const opened = await open(world, { binding_message: HOSTILE });
    const res = await get(opened.path, aliceCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script');
    expect(res.body).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &amp; &#39;&lt;/script&gt;',
    );
    expect(res.body).not.toContain('&amp;lt;');
  });

  it('[ODUDU-APPROVAL-PAGE-04] answers an approval of someone else exactly as it answers one that does not exist', async () => {
    const opened = await open(world);
    const other = await get(opened.path, bobCookie);
    const missing = await get(MISSING, bobCookie);
    const notAnId = await get(`/tenants/${world.tenant}/approval/not-an-id`, bobCookie);
    expect(other.statusCode).toBe(404);
    for (const same of [missing, notAnId]) {
      expect(same.statusCode).toBe(other.statusCode);
      expect(same.body).toBe(other.body);
      expect(same.headers['content-type']).toBe(other.headers['content-type']);
      expect(same.headers['content-security-policy']).toBe(
        other.headers['content-security-policy'],
      );
    }
    expect(other.body).not.toContain('Client agent');
    expect(other.body).not.toContain(opened.approvalId);
  });

  it('[ODUDU-APPROVAL-PAGE-05] answers an approval of another tenant the same way', async () => {
    const foreign = await seedCibaWorld(app, 'foreign');
    const theirs = await open(foreign);
    const asked = await get(`/tenants/${world.tenant}/approval/${theirs.approvalId}`, aliceCookie);
    const missing = await get(MISSING, aliceCookie);
    expect(asked.statusCode).toBe(404);
    expect(asked.body).toBe(missing.body);
  });

  it('[ODUDU-APPROVAL-PAGE-06] answers an expired approval with the same page, and a decision on it changes nothing', async () => {
    const opened = await open(world, { requested_expiry: '30' });
    const csrf = csrfOf(await get(opened.path, aliceCookie));
    clock.advance(31_000);
    const expired = await get(opened.path, aliceCookie);
    const missing = await get(MISSING, aliceCookie);
    expect(expired.statusCode).toBe(404);
    expect(expired.body).toBe(missing.body);
    const decided = await post(opened.path, { decision: 'approve', csrf }, aliceCookie);
    expect(decided.statusCode).toBe(404);
    expect(decided.body).toBe(missing.body);
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-07] refuses a decision without a valid token and changes nothing', async () => {
    const opened = await open(world);
    for (const csrf of [undefined, '', 'forged']) {
      const res = await post(opened.path, { decision: 'approve', csrf }, aliceCookie);
      expect(res.statusCode).toBe(403);
    }
    const noSession = await post(opened.path, { decision: 'approve', csrf: 'x' });
    expect(noSession.statusCode).toBe(302);
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-08] refuses the token of another approval and of another session', async () => {
    const mine = await open(world);
    const second = await open(world);
    const forThis = csrfOf(await get(mine.path, aliceCookie));
    const forSecond = csrfOf(await get(second.path, aliceCookie));
    const otherSession = await signedInCookie(app, world, world.alice.subjectId, clock.now());
    const forOtherSession = csrfOf(await get(mine.path, otherSession));
    expect(forThis).not.toBe(forSecond);
    for (const csrf of [forSecond, forOtherSession]) {
      const res = await post(mine.path, { decision: 'approve', csrf }, aliceCookie);
      expect(res.statusCode).toBe(403);
    }
    expect((await stateOf(mine.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-09] approves for the signed-in owner through the one decision writer, and the poll returns tokens', async () => {
    const opened = await open(world);
    const csrf = csrfOf(await get(opened.path, aliceCookie));
    const res = await post(opened.path, { decision: 'approve', csrf }, aliceCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Request approved');
    expect(res.body).not.toContain('<form');
    expect(await stateOf(opened.approvalId)).toEqual([
      { state: 'approved', decided_via: 'ciba_page' },
    ]);
    clock.advance(6000);
    const tokens = await poll(world, opened.authReqId);
    expect(tokens.statusCode, tokens.body).toBe(200);
    expect(tokens.json<{ access_token: string }>().access_token).toBeTruthy();
  });

  it('[ODUDU-APPROVAL-PAGE-10] denies, and the poll says access_denied', async () => {
    const opened = await open(world);
    const csrf = csrfOf(await get(opened.path, aliceCookie));
    const res = await post(opened.path, { decision: 'deny', csrf }, aliceCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Request denied');
    expect((await stateOf(opened.approvalId))[0]).toMatchObject({
      state: 'denied',
      decided_via: 'ciba_page',
    });
    clock.advance(6000);
    expect((await poll(world, opened.authReqId)).json()).toMatchObject({ error: 'access_denied' });
  });

  it('[ODUDU-APPROVAL-PAGE-11] lets one decision through, and answers a second like an unknown approval', async () => {
    const opened = await open(world);
    const csrf = csrfOf(await get(opened.path, aliceCookie));
    expect((await post(opened.path, { decision: 'deny', csrf }, aliceCookie)).statusCode).toBe(200);
    const again = await post(opened.path, { decision: 'approve', csrf }, aliceCookie);
    const missing = await get(MISSING, aliceCookie);
    expect(again.statusCode).toBe(404);
    expect(again.body).toBe(missing.body);
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('denied');
    expect((await get(opened.path, aliceCookie)).body).toBe(missing.body);
  });

  it('[ODUDU-APPROVAL-PAGE-12] a signed-in person who does not own the approval cannot decide it, even with a valid token of their own', async () => {
    const opened = await open(world);
    const aliceToken = csrfOf(await get(opened.path, aliceCookie));
    expect(
      (await post(opened.path, { decision: 'approve', csrf: aliceToken }, bobCookie)).statusCode,
    ).toBe(403);
    const bobEntry = SessionEntry.parse(bobCookie.split('=')[1] ?? '');
    const bobToken = bobEntry?.proof(APPROVAL_DECISION, [opened.approvalId]) ?? '';
    const res = await post(opened.path, { decision: 'approve', csrf: bobToken }, bobCookie);
    const missing = await get(MISSING, bobCookie);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(missing.body);
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-13] a client holding its own credentials cannot decide', async () => {
    const opened = await open(world);
    const res = await http.inject({
      method: 'POST',
      url: opened.path,
      headers: { ...FORM, ...basic(world.agent) },
      payload: form({ decision: 'approve', csrf: 'x' }),
    });
    expect(res.statusCode).toBe(302);
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-14] does not decide on a GET', async () => {
    const opened = await open(world);
    await http.inject({
      method: 'GET',
      url: `${opened.path}?decision=approve`,
      headers: { cookie: aliceCookie },
    });
    expect((await stateOf(opened.approvalId))[0]?.state).toBe('pending');
  });

  it('[ODUDU-APPROVAL-PAGE-15] finds the owner among several accounts signed in to one browser', async () => {
    const opened = await open(world);
    const both = `${world.tenant}-session=${bobCookie.split('=')[1] ?? ''}.${aliceCookie.split('=')[1] ?? ''}`;
    const res = await get(opened.path, both);
    expect(res.statusCode).toBe(200);
  });
});

describe('the approval page for a person at the pending limit', () => {
  it('[ODUDU-APPROVAL-PAGE-16] still shows and decides an approval they already hold', async () => {
    const full = await seedCibaWorld(app, 'page-cap');
    const cookie = await signedInCookie(app, full, full.alice.subjectId, clock.now());
    const held = await open(full);
    for (let i = 0; i < 19; i += 1) {
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
    const refused = await http.inject({
      method: 'POST',
      url: `/tenants/${full.tenant}/protocol/openid-connect/bc-authorize`,
      headers: { ...FORM, ...basic(full.agent) },
      payload: form({ scope: 'openid', login_hint: 'alice' }),
    });
    expect(refused.statusCode).toBe(200);
    const page = await get(`/tenants/${full.tenant}/approval/${held.approvalId}`, cookie);
    expect(page.statusCode).toBe(200);
    const res = await post(
      `/tenants/${full.tenant}/approval/${held.approvalId}`,
      { decision: 'approve', csrf: csrfOf(page) },
      cookie,
    );
    expect(res.statusCode).toBe(200);
    expect((await stateOf(held.approvalId))[0]?.state).toBe('approved');
  });
});

describe('what the generic page leaves out', () => {
  it('[ODUDU-APPROVAL-PAGE-18] is one whole response, headers included, for every approval that is not the signed-in owner’s pending one', async () => {
    const decided = await open(world);
    const token = csrfOf(await get(decided.path, aliceCookie));
    await post(decided.path, { decision: 'deny', csrf: token }, aliceCookie);
    const expiring = await open(world, { requested_expiry: '30' });
    const theirs = await open(await seedCibaWorld(app, 'page-foreign'));
    const mine = await open(world);
    clock.advance(31_000);
    const answers = [
      await get(MISSING, aliceCookie),
      await get(`/tenants/${world.tenant}/approval/not-an-id`, aliceCookie),
      await get(mine.path, bobCookie),
      await get(`/tenants/${world.tenant}/approval/${theirs.approvalId}`, aliceCookie),
      await get(expiring.path, aliceCookie),
      await get(decided.path, aliceCookie),
    ];
    const whole = (res: LightMyRequestResponse) => {
      const headers = Object.fromEntries(
        Object.entries(res.headers).filter(([name]) => name !== 'date'),
      );
      return { status: res.statusCode, headers, body: res.body };
    };
    const [first] = answers;
    if (first === undefined) throw new Error('no answers');
    for (const res of answers) {
      expect(whole(res)).toEqual(whole(first));
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
});

describe('a deployment with no sign-in to send a person to', () => {
  it('[ODUDU-APPROVAL-PAGE-17] answers a person with no session with 403 and a page that says to sign in, naming no approval', async () => {
    const bare = Fastify();
    await bare.register(formbody);
    await bare.register(
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
      }),
    );
    await bare.ready();
    try {
      const opened = await open(world);
      for (const method of ['GET', 'POST'] as const) {
        const res = await bare.inject({ method, url: opened.path, payload: '' });
        expect(res.statusCode).toBe(403);
        expect(res.headers.location).toBeUndefined();
        expect(res.body).toContain('Sign in to continue');
        expect(res.body).not.toContain(opened.approvalId);
      }
    } finally {
      await bare.close();
    }
  });
});
