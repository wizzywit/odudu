import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actionTokenRepository } from '#/repository/action-tokens';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { actionTokens } from '#/schema/action-tokens';
import { type MailGate } from '#/service/mail-gate';
import { accountTestDeps, linkRouteDeps, openAndPress } from '#/testing/support';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { registerResendVerificationRoute } from '#/view/routes/resend-verification';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Fixture {
  tenantId: string;
  tenantName: string;
  subject: string;
}

// What the composition root's `proofOwed` reads from the identity tables,
// against a fixture this file owns: @odudu/account never imports them.
const users = new Map<string, { email: string; verified: boolean; locale: string | null }>();
const pending = new Map<string, string>();
let gateAnswer = true;
const gateCalls: string[] = [];
const gate: MailGate = (kind, _tenant, address) => {
  gateCalls.push(`${kind}:${address}`);
  return gateAnswer;
};

let http: FastifyInstance;
let tenant: Fixture;
let other: Fixture;

async function fixture(): Promise<Fixture> {
  const tenantId = newId();
  const tenantName = `tenant-${newId()}`;
  await owner.db.insert(tenants).values({ id: tenantId, name: tenantName });
  const subject = newId();
  await withTenant(app.db, tenantId, (tx) =>
    tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${subject}, ${tenantId}, 'user')`,
    ),
  );
  users.set(subject, { email: 'ada@example.test', verified: false, locale: null });
  return { tenantId, tenantName, subject };
}

async function build(): Promise<FastifyInstance> {
  const instance = Fastify();
  instance.register(formbody);
  const findTenant = (name: string) => tenantSettingsRepository(owner.db).byName(name);
  registerActionTokenRoute(instance, {
    ...accountTestDeps,
    ...linkRouteDeps(),
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant,
    getCurrentEmail: (_tx, subjectId) => Promise.resolve(users.get(subjectId)?.email ?? null),
    markVerified: (_tx, subjectId) => {
      const user = users.get(subjectId);
      if (user !== undefined) user.verified = true;
      return Promise.resolve();
    },
  });
  registerResendVerificationRoute(instance, {
    ...accountTestDeps,
    database: app,
    findTenant,
    publicBaseUrl: 'https://idp.example.test',
    mailGate: gate,
    proofOwed: (_tx, subjectId, email) => {
      const user = users.get(subjectId);
      if (user === undefined) return Promise.resolve(null);
      const owed = (user.email === email && !user.verified) || pending.get(subjectId) === email;
      return Promise.resolve(owed ? { locale: user.locale } : null);
    },
  });
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  users.clear();
  pending.clear();
  gateAnswer = true;
  gateCalls.length = 0;
  await owner.db.delete(emailOutbox);
  tenant = await fixture();
  other = await fixture();
  http = await build();
});

async function issue(
  f: Fixture,
  patch: {
    email?: string;
    returnTo?: { clientId: string; uri: string };
    spent?: 'expired' | 'used';
  } = {},
): Promise<string> {
  const { token } = await withTenant(app.db, f.tenantId, (tx) =>
    actionTokenRepository(tx).issue({
      tenantId: f.tenantId,
      subjectId: f.subject,
      type: 'verify_email',
      email: patch.email ?? 'ada@example.test',
      returnTo: patch.returnTo,
      ttlSeconds: 3600,
    }),
  );
  if (patch.spent === 'expired') {
    await owner.db
      .update(actionTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(actionTokens.tenantId, f.tenantId));
  }
  if (patch.spent === 'used') {
    await owner.db
      .update(actionTokens)
      .set({ consumedAt: new Date() })
      .where(eq(actionTokens.tenantId, f.tenantId));
  }
  return token;
}

function resend(f: Fixture, key: string) {
  return http.inject({
    method: 'POST',
    url: `/tenants/${f.tenantName}/login-actions/resend-verification`,
    payload: new URLSearchParams({ key }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

const queued = (f: Fixture) =>
  withTenant(app.db, f.tenantId, (tx) => tx.select().from(emailOutbox));
const tokensOf = (f: Fixture) =>
  withTenant(app.db, f.tenantId, (tx) => tx.select().from(actionTokens));
const auditOf = (f: Fixture) =>
  withTenant(app.db, f.tenantId, async (tx) => auditRepository(tx).list({ limit: 50 }));

describe('the page a refused verification link shows', () => {
  it('offers a form that carries the key, for a spent link and for one nothing holds alike', async () => {
    const expired = await issue(tenant, { spent: 'expired' });
    const pages = await Promise.all(
      [expired, 'never-issued'].map((key) =>
        http.inject({
          url: `/tenants/${tenant.tenantName}/login-actions/action-token?key=${key}`,
        }),
      ),
    );
    for (const [i, res] of pages.entries()) {
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(
        `<form method="post" action="/tenants/${tenant.tenantName}/login-actions/resend-verification">`,
      );
      expect(res.body).toContain(`name="key" value="${i === 0 ? expired : 'never-issued'}"`);
    }
  });

  it('names the address and the tenant on the page that asks for the click, and completes nothing', async () => {
    const key = await issue(tenant);
    const opened = await http.inject({
      url: `/tenants/${tenant.tenantName}/login-actions/action-token?key=${key}`,
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.body).toContain('Email address: <bdi>ada@example.test</bdi>');
    expect(opened.body).toContain(`Account at <bdi>${tenant.tenantName}</bdi>`);
    expect(users.get(tenant.subject)?.verified).toBe(false);
    expect((await tokensOf(tenant))[0]?.consumedAt).toBeNull();

    const posted = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant.tenantName}/login-actions/action-token`,
      payload: new URLSearchParams({ key }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(posted.statusCode).toBe(200);
    expect(users.get(tenant.subject)?.verified).toBe(true);
    expect((await tokensOf(tenant))[0]?.consumedAt).not.toBeNull();
  });
});

describe('asking for a new verification link', () => {
  const GENERIC = 'If this address needs verifying, a new link is on its way.';

  it.each(['expired', 'used'] as const)(
    'queues one mail for a link that is %s, and audits it without the address',
    async (spent) => {
      const key = await issue(tenant, { spent });
      const res = await resend(tenant, key);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(GENERIC);
      expect(await queued(tenant)).toHaveLength(1);
      expect((await queued(tenant))[0]?.toAddress).toBe('ada@example.test');
      expect(await tokensOf(tenant)).toHaveLength(2);
      const rows = (await auditOf(tenant)).filter((r) => r.action === 'email.verification_resent');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventType: 'credential',
        outcome: 'allowed',
        resourceType: 'subject',
        resourceId: tenant.subject,
        actorSubjectId: null,
      });
      expect(JSON.stringify(rows[0])).not.toContain('ada@example.test');
      expect(gateCalls).toEqual(['verification:ada@example.test']);
    },
  );

  it('answers the same page and sends nothing for a key nothing holds, a verified address, a spent budget and a link of another kind', async () => {
    const answers: string[] = [];
    answers.push((await resend(tenant, 'never-issued')).body);

    users.set(tenant.subject, { email: 'ada@example.test', verified: true, locale: null });
    answers.push((await resend(tenant, await issue(tenant, { spent: 'expired' }))).body);

    users.set(tenant.subject, { email: 'ada@example.test', verified: false, locale: null });
    gateAnswer = false;
    answers.push((await resend(tenant, await issue(tenant, { spent: 'expired' }))).body);
    gateAnswer = true;

    const { token } = await withTenant(app.db, tenant.tenantId, (tx) =>
      actionTokenRepository(tx).issue({
        tenantId: tenant.tenantId,
        subjectId: tenant.subject,
        type: 'reset_password',
        email: 'ada@example.test',
        ttlSeconds: 3600,
      }),
    );
    answers.push((await resend(tenant, token)).body);

    const sent = await resend(tenant, await issue(tenant, { spent: 'expired' }));
    expect(new Set([...answers, sent.body]).size).toBe(1);
    expect(sent.body).toContain(GENERIC);
    expect(await queued(tenant)).toHaveLength(1);
    expect(
      (await auditOf(tenant)).filter((r) => r.action === 'email.verification_resent'),
    ).toHaveLength(1);
  });

  it('does not spend the budget for an address that needs nothing', async () => {
    users.set(tenant.subject, { email: 'ada@example.test', verified: true, locale: null });
    await resend(tenant, await issue(tenant, { spent: 'used' }));
    expect(gateCalls).toEqual([]);
  });

  it('keeps the client the link returned to, as the new link names it', async () => {
    const clientId = newId();
    const key = await issue(tenant, {
      spent: 'expired',
      returnTo: { clientId, uri: 'https://app.example/cb' },
    });
    await resend(tenant, key);

    const fresh = (await tokensOf(tenant)).find(
      (t) => t.consumedAt === null && t.expiresAt > new Date(),
    );
    expect(fresh).toMatchObject({ clientId, returnUri: 'https://app.example/cb' });
  });

  it('proves a pending address again while it is still the pending one, and not once it was replaced', async () => {
    pending.set(tenant.subject, 'new@example.test');
    users.set(tenant.subject, { email: 'ada@example.test', verified: true, locale: null });
    const stale = await issue(tenant, { email: 'new@example.test', spent: 'expired' });

    await resend(tenant, stale);
    expect(await queued(tenant)).toHaveLength(1);

    pending.set(tenant.subject, 'newer@example.test');
    await resend(tenant, stale);
    expect(await queued(tenant)).toHaveLength(1);
  });

  it('answers a key of another tenant as a key nothing holds', async () => {
    const foreign = await issue(other, { spent: 'expired' });
    const res = await resend(tenant, foreign);

    expect(res.body).toContain(GENERIC);
    expect(await queued(tenant)).toHaveLength(0);
    expect(await queued(other)).toHaveLength(0);
    expect(gateCalls).toEqual([]);
  });

  it('answers the same page for a tenant that does not exist, and with no key', async () => {
    const reference = (await resend(tenant, 'never-issued')).body;
    const unknown = await http.inject({
      method: 'POST',
      url: '/tenants/does-not-exist/login-actions/resend-verification',
      payload: 'key=x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const none = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant.tenantName}/login-actions/resend-verification`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(unknown.body).toBe(reference);
    expect(none.body).toBe(reference);
  });

  it.each([
    ['no body and no content type', undefined, undefined],
    ['an empty urlencoded body', '', 'application/x-www-form-urlencoded'],
    ['a JSON null body', 'null', 'application/json'],
  ] as const)('answers the same page for %s', async (_label, payload, contentType) => {
    const reference = await resend(tenant, 'never-issued');
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant.tenantName}/login-actions/resend-verification`,
      ...(payload === undefined ? {} : { payload }),
      ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }),
    });
    expect(res.statusCode).toBe(reference.statusCode);
    expect(res.body).toBe(reference.body);
  });

  it.each([
    ['no body and no content type', undefined, undefined],
    ['a JSON null body', 'null', 'application/json'],
  ] as const)(
    'answers %s on the completion address as it answers an empty form',
    async (_label, payload, contentType) => {
      const tenantName = tenant.tenantName;
      const url = `/tenants/${tenantName}/login-actions/action-token`;
      const empty = await http.inject({
        method: 'POST',
        url,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      const res = await http.inject({
        method: 'POST',
        url,
        ...(payload === undefined ? {} : { payload }),
        ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }),
      });
      expect(res.statusCode).toBe(empty.statusCode);
      expect(res.statusCode).toBeLessThan(500);
      const bare = (html: string): string => html.replace(/nonce="[^"]*"/g, 'nonce=""');
      expect(bare(res.body)).toBe(bare(empty.body));
    },
  );

  it('a mail scanner opening the resend address changes nothing', async () => {
    const res = await http.inject({
      url: `/tenants/${tenant.tenantName}/login-actions/resend-verification`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the mail a resend queues', () => {
  it('carries a link that verifies the address when its page is pressed', async () => {
    await resend(tenant, await issue(tenant, { spent: 'expired' }));

    const [mail] = await queued(tenant);
    const link = /visiting this link:\n\n(\S+)/u.exec(mail?.bodyText ?? '')?.[1];
    if (link === undefined) throw new Error('no link in the queued mail');
    const key = new URL(link).searchParams.get('key') ?? '';

    expect(users.get(tenant.subject)?.verified).toBe(false);
    expect((await openAndPress(http, tenant.tenantName, key)).statusCode).toBe(200);
    expect(users.get(tenant.subject)?.verified).toBe(true);
  });
});
