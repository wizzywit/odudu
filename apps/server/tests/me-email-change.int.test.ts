import { SessionEntry, sessionRepository, sessions } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// Changing the address through the real app: the request, the mail it queues
// and the link that completes it.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
// The same server with no relay of its own, as a deployment that cannot send mail.
let noMailApp: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const NEW = 'ada.new@example.com';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  const options = {
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  };
  app = buildApp({ ...options, deploymentSmtp: true });
  noMailApp = buildApp({ ...options, deploymentSmtp: false });
  await app.ready();
  await noMailApp.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  await noMailApp.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly sessionId: string;
}

async function world(): Promise<World> {
  const name = `mec-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
    email: 'ada@example.com',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  const entry = SessionEntry.issue(newId());
  await withTenant(appDb.db, tenantId, (tx) =>
    sessionRepository(tx).create({
      id: entry.id,
      tenantId,
      subjectId: seeded.userSubjectId ?? '',
      expiresAt: new Date(Date.now() + 3_600_000),
      authenticators: ['pwd'],
      secretHash: entry.secretHash(),
    }),
  );
  return {
    name,
    tenantId,
    issuer: `${BASE}/tenants/${name}`,
    subjectId: seeded.userSubjectId,
    sessionId: entry.id,
  };
}

async function sign(w: World, claims: Record<string, unknown> = {}): Promise<string> {
  const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'portal',
      sid: w.sessionId,
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function ask(w: World, body: unknown, token?: string) {
  return app.inject({
    method: 'PATCH',
    url: `/tenants/${w.name}/me/profile`,
    headers: { host: HOST, authorization: `Bearer ${token ?? (await sign(w))}` },
    payload: body as object,
  });
}

const userOf = (w: World, subjectId = w.subjectId) =>
  withTenant(appDb.db, w.tenantId, (tx) => userRepository(tx).bySubjectId(subjectId));

const mail = (w: World) =>
  withTenant(appDb.db, w.tenantId, async (tx) =>
    (await tx.select().from(emailOutbox)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    ),
  );

const pendingOf = (w: World) =>
  owner.sql<
    { email: string }[]
  >`select email from pending_email_changes where subject_id = ${w.subjectId}`;

const auditRows = (w: World, action: string) =>
  withTenant(appDb.db, w.tenantId, (tx) => auditRepository(tx).list({ action, limit: 50 }));

// The link in a queued mail, as a path and query the app can be asked for.
function linkOf(message: { bodyText: string }): string {
  const found = /(https:\/\/\S+\/login-actions\/action-token\?key=\S+)/u.exec(message.bodyText);
  if (found?.[1] === undefined) throw new Error('no link in the mail');
  const url = new URL(found[1]);
  return `${url.pathname}${url.search}`;
}

// What a person does with the mailed link: open it, then press the button.
async function press(link: string) {
  const opened = await app.inject({ url: link, headers: { host: HOST } });
  const key = /<input type="hidden" name="key" value="([^"]*)">/u.exec(opened.body)?.[1];
  if (opened.statusCode !== 200 || key === undefined) return opened;
  return app.inject({
    method: 'POST',
    url: link.split('?')[0] ?? link,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ key }).toString(),
  });
}

async function requestAndGetLink(w: World, address = NEW): Promise<string> {
  const res = await ask(w, { email: address });
  expect(res.statusCode).toBe(202);
  const message = (await mail(w)).at(-1);
  if (message === undefined) throw new Error('no mail queued');
  return linkOf(message);
}

describe('PATCH /me/profile with an email', () => {
  it('stores the pending address and queues one mail, to the new address only', async () => {
    const w = await world();
    const res = await ask(w, { email: NEW });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ email_verification_sent: true });
    expect(res.headers['cache-control']).toBe('no-store');

    expect(await pendingOf(w)).toEqual([{ email: NEW }]);
    const queued = await mail(w);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.toAddress).toBe(NEW);
    expect((queued[0]?.bodyText ?? '') + (queued[0]?.bodyHtml ?? '')).not.toContain(
      'ada@example.com',
    );
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });

    const rows = await auditRows(w, 'subject.profile_amend');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toEqual({
      via: 'me',
      fields: ['email'],
      pending: true,
      notice: 'skipped_unverified',
    });
    expect(JSON.stringify(rows)).not.toContain(NEW);
  });

  it('answers 401 with a challenge when the sign-in is old, and writes nothing', async () => {
    const w = await world();
    await owner.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(sessions.id, w.sessionId));
    const res = await ask(w, { email: NEW });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('insufficient_user_authentication');
    expect(await pendingOf(w)).toEqual([]);
    expect(await mail(w)).toEqual([]);
  });

  it('refuses an agent token', async () => {
    const w = await world();
    const token = await sign(w, { act: { sub: 'agent-1', client_id: 'agent' } });
    const res = await ask(w, { email: NEW }, token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
    expect(await pendingOf(w)).toEqual([]);
  });

  it.each([[null], ['no way'], ['a@b'], [7]])('answers 400 for the address %j', async (email) => {
    const w = await world();
    const res = await ask(w, { email });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(await mail(w)).toEqual([]);
  });

  it('answers 202 for an address another account holds, in any case, and sends nothing', async () => {
    const w = await world();
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: other.id,
        tenantId: w.tenantId,
        username: 'grace',
        email: 'Grace@Example.com',
      });
    });
    const res = await ask(w, { email: 'grace@example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ email_verification_sent: true });
    expect(await mail(w)).toEqual([]);
    expect(await pendingOf(w)).toEqual([]);
    const rows = await auditRows(w, 'subject.profile_amend');
    expect(rows[0]?.detail).toEqual({ via: 'me', fields: ['email'], skipped: 'address_in_use' });
  });

  it('tells the verified address being left once, and sends the link only to the new one', async () => {
    const w = await world();
    await owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;
    expect((await ask(w, { email: NEW })).statusCode).toBe(202);
    const queued = await mail(w);
    expect(queued.map((row) => row.toAddress).sort()).toEqual(['ada@example.com', NEW].sort());
    const notice = queued.find((row) => row.toAddress === 'ada@example.com');
    expect(notice?.subject).toMatch(/^A new email address was requested for your/u);
    expect(notice?.bodyText).not.toMatch(/action-token|https?:/u);
    expect(notice?.bodyText).not.toContain(NEW);
    const link = queued.find((row) => row.toAddress === NEW);
    expect(link?.bodyText).toContain('action-token');
    expect((await auditRows(w, 'subject.profile_amend'))[0]?.detail).toMatchObject({
      pending: true,
      notice: 'sent',
    });
  });

  it('tells nobody when the address asked for is held by another account', async () => {
    const w = await world();
    await owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const second = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: second.id,
        tenantId: w.tenantId,
        username: 'second',
        email: 'second@example.com',
      });
    });
    expect((await ask(w, { email: 'second@example.com' })).statusCode).toBe(202);
    expect(await mail(w)).toEqual([]);
  });

  it('answers a free address and another account’s address with the same status, body and headers', async () => {
    const w = await world();
    const free = await ask(w, { email: NEW });
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const second = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: second.id,
        tenantId: w.tenantId,
        username: 'second',
        email: 'second@example.com',
      });
    });
    const taken = await ask(w, { email: 'Second@Example.com' });
    expect(taken.statusCode).toBe(free.statusCode);
    expect(taken.body).toBe(free.body);
    expect(taken.headers['cache-control']).toBe(free.headers['cache-control']);
    expect(taken.headers['content-type']).toBe(free.headers['content-type']);
  });

  it('forgets an earlier pending address when a later request is skipped', async () => {
    const w = await world();
    const old = await requestAndGetLink(w, 'first@example.com');
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const second = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: second.id,
        tenantId: w.tenantId,
        username: 'second',
        email: 'second@example.com',
      });
    });
    expect((await ask(w, { email: 'second@example.com' })).statusCode).toBe(202);
    expect(await pendingOf(w)).toEqual([]);
    expect((await press(old)).statusCode).toBe(400);
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });
  });

  it('answers 503 where the deployment cannot send mail, whatever the address', async () => {
    const w = await world();
    for (const email of [NEW, 'ada@example.com']) {
      const res = await noMailApp.inject({
        method: 'PATCH',
        url: `/tenants/${w.name}/me/profile`,
        headers: { host: HOST, authorization: `Bearer ${await sign(w)}` },
        payload: { email },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'mail_unavailable' });
    }
    expect(await pendingOf(w)).toEqual([]);
    expect(await mail(w)).toEqual([]);
  });
});

describe('completing the mailed link', () => {
  it('gives an address to a person who had none', async () => {
    const w = await world();
    await owner.sql`update users set email = null where subject_id = ${w.subjectId}`;
    const link = await requestAndGetLink(w);
    expect((await press(link)).statusCode).toBe(200);
    expect(await userOf(w)).toMatchObject({ email: NEW, emailVerified: true });
    expect(await pendingOf(w)).toEqual([]);
  });

  it('swaps the address in, verified, and keeps the person’s sessions', async () => {
    const w = await world();
    const link = await requestAndGetLink(w);
    const before = await userOf(w);
    expect(before).toMatchObject({ email: 'ada@example.com' });

    const opened = await app.inject({ url: link, headers: { host: HOST } });
    expect(opened.statusCode).toBe(200);
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });

    expect((await press(link)).statusCode).toBe(200);
    expect(await userOf(w)).toMatchObject({ email: NEW, emailVerified: true });
    expect(await pendingOf(w)).toEqual([]);
    const changed = await auditRows(w, 'email.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.actorSubjectId).toBe(w.subjectId);
    const live = await owner.db.select().from(sessions).where(eq(sessions.id, w.sessionId));
    expect(live).toHaveLength(1);
  });

  it('refuses a second use of the link', async () => {
    const w = await world();
    const link = await requestAndGetLink(w);
    expect((await press(link)).statusCode).toBe(200);
    expect((await press(link)).statusCode).toBe(400);
    expect(await userOf(w)).toMatchObject({ email: NEW });
  });

  it('refuses the link of a request that a later one replaced, and honors the later one', async () => {
    const w = await world();
    const first = await requestAndGetLink(w, 'first@example.com');
    const second = await requestAndGetLink(w, 'second@example.com');

    expect((await press(first)).statusCode).toBe(400);
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });
    expect(await pendingOf(w)).toEqual([{ email: 'second@example.com' }]);

    expect((await press(second)).statusCode).toBe(200);
    expect(await userOf(w)).toMatchObject({ email: 'second@example.com', emailVerified: true });
  });

  it('refuses the swap when another account has taken the address meanwhile', async () => {
    const w = await world();
    const link = await requestAndGetLink(w);
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: other.id,
        tenantId: w.tenantId,
        username: 'grace',
        email: NEW.toUpperCase().replace('@EXAMPLE.COM', '@example.com'),
      });
    });
    expect((await press(link)).statusCode).toBe(400);
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });
    expect(await auditRows(w, 'email.changed')).toEqual([]);
  });

  it('refuses another tenant’s link', async () => {
    const w = await world();
    const stranger = await world();
    const link = await requestAndGetLink(w);
    const foreign = link.replace(`/tenants/${w.name}/`, `/tenants/${stranger.name}/`);
    expect((await press(foreign)).statusCode).toBe(400);
    expect(await userOf(w)).toMatchObject({ email: 'ada@example.com' });
    expect(await pendingOf(w)).toEqual([{ email: NEW }]);
  });
});
