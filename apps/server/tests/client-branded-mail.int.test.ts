import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { emailOutbox } from '@odudu/email';
import { clients } from '@odudu/domain-tenant';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, desc, eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createBranding, type Branding } from '#/branding';
import { seed } from '#/cli/seed';
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// A mail takes the look of the client whose sign-in the flow began inside,
// and of nothing a request says: through the real composition root, on a real
// database.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let branding: Branding;
const recorder = new StatementRecorder();

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const TENANT_CAP = 8 * 1024 * 1024;
const LIGHT = {
  surfacePage: '#ffffff',
  surfacePanel: '#fafafa',
  surfaceSunken: '#f0f0f0',
  inkPrimary: '#111111',
  inkMuted: '#555555',
  signalActive: '#ddeedd',
  signalActiveInk: '#004400',
  signalDanger: '#fde0d0',
  signalDangerInk: '#802000',
  borderStrong: '#777777',
  focusRing: '#0044aa',
};
const TENANT_LOOK = { ...LIGHT, surfacePanel: '#f1f2f3' };
const PORTAL_LOOK = { ...LIGHT, surfacePanel: '#e0f0ff' };
const OTHER_LOOK = { ...LIGHT, surfacePanel: '#ffe0f0' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5, onQueryForTests: recorder.hook('app') });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = pino({ level: 'silent' });
  branding = createBranding({ database: appDb, logger, publicBaseUrl: BASE });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: false,
    publicBaseUrl: BASE,
    branding,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  name: string;
  tenantId: string;
  portalRowId: string;
  email: string;
}

async function world(): Promise<World> {
  const name = `cbm-${newId()}`;
  const username = `u${newId().slice(-8)}`;
  const email = `${username}@example.test`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username,
    password: PASSWORD,
    email,
  });
  await owner.db
    .update(tenants)
    .set({ resetPasswordAllowed: true, registrationAllowed: true, verifyEmail: true })
    .where(eq(tenants.id, seeded.tenantId));
  const [portal] = await owner.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, seeded.tenantId), eq(clients.clientId, 'portal')));
  return { name, tenantId: seeded.tenantId, portalRowId: portal?.id ?? '', email };
}

async function secondClient(w: World): Promise<string> {
  const id = newId();
  await owner.db.insert(clients).values({
    id,
    tenantId: w.tenantId,
    clientId: 'other',
    name: 'Other',
    type: 'public',
    secretHash: null,
  });
  return id;
}

function theme(parts: Partial<ThemeBody>): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

async function publish(w: World, clientRowId: string | null, body: ThemeBody): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId: clientRowId };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
  branding.invalidateTenant(w.tenantId);
}

async function putLogo(w: World, size: { width: number; height: number }) {
  const bytes = makePng(size);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await withTenant(appDb.db, w.tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId: w.tenantId,
      sha256,
      mime: 'image/png',
      ...size,
      bytes,
      tenantCapBytes: TENANT_CAP,
    }),
  );
  if (stored === 'over_cap') throw new Error('over cap');
  return { id: stored.id, url: `${BASE}/tenants/${w.name}/brand/${sha256}.png` };
}

function request(
  method: 'GET' | 'POST',
  url: string,
  fields?: Record<string, string>,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    ...(fields === undefined ? {} : { payload: new URLSearchParams(fields).toString() }),
    headers: {
      ...(fields === undefined ? {} : FORM),
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function hrefLabelled(res: LightMyRequestResponse, label: string): string {
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const raw = new RegExp(`<a href="([^"]*)">${escaped}</a>`, 'u').exec(res.body)?.[1];
  if (raw === undefined) throw new Error(`no link labelled ${label}`);
  return unescapeHtml(raw);
}

function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const pair = values
    .map((value) => value.split(';')[0] ?? '')
    .find((p) => p.startsWith('odudu-sign-in='));
  if (pair === undefined) throw new Error('the login page set no sign-in cookie');
  return pair;
}

function authorizePath(name: string, clientId: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}`;
}

interface Parked {
  cookie: string;
  carried: string;
}

// A browser that opened a client's sign-in and followed the link to `page`.
async function park(w: World, page: 'Forgot password?' | 'Create an account'): Promise<Parked> {
  const login = await request('GET', authorizePath(w.name, 'portal'));
  const cookie = cookieOf(login);
  const form = await request('GET', hrefLabelled(login, page), undefined, cookie);
  return { cookie, carried: hrefLabelled(form, 'Back to sign in') };
}

async function mailHtmlTo(address: string): Promise<string> {
  const [row] = await owner.db
    .select({ html: emailOutbox.bodyHtml })
    .from(emailOutbox)
    .where(eq(emailOutbox.toAddress, address))
    .orderBy(desc(emailOutbox.createdAt));
  if (row === undefined) throw new Error(`no mail to ${address}`);
  return row.html;
}

function askReset(
  w: World,
  fields: Record<string, string>,
  cookie: string | undefined,
  email = w.email,
): Promise<LightMyRequestResponse> {
  return request(
    'POST',
    `/tenants/${w.name}/login-actions/reset-password`,
    { email, ...fields },
    cookie,
  );
}

describe('a reset mail asked for from a client sign-in', () => {
  it("wears the client's colours and logo over the tenant's, per piece", async () => {
    const w = await world();
    const tenantLogo = await putLogo(w, { width: 100, height: 100 });
    const clientLogo = await putLogo(w, { width: 480, height: 96 });
    await publish(
      w,
      null,
      theme({
        tokens: { light: TENANT_LOOK },
        assets: { logo: { assetId: tenantLogo.id, alt: 'Tenant logo' } },
      }),
    );
    await publish(
      w,
      w.portalRowId,
      theme({
        tokens: { light: PORTAL_LOOK },
        assets: { logo: { assetId: clientLogo.id, alt: 'Portal logo' } },
      }),
    );
    const parked = await park(w, 'Forgot password?');
    const sent = await askReset(w, { return_to: parked.carried }, parked.cookie);
    expect(sent.statusCode).toBe(200);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#e0f0ff');
    expect(html).not.toContain('#f1f2f3');
    expect(html).toContain(clientLogo.url);
    expect(html).toContain('alt="Portal logo"');
    expect(html).not.toContain(tenantLogo.url);
  });

  it('keeps the tenant logo the client did not replace', async () => {
    const w = await world();
    const tenantLogo = await putLogo(w, { width: 100, height: 100 });
    await publish(
      w,
      null,
      theme({
        tokens: { light: TENANT_LOOK },
        assets: { logo: { assetId: tenantLogo.id, alt: 'Tenant logo' } },
      }),
    );
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    const parked = await park(w, 'Forgot password?');
    await askReset(w, { return_to: parked.carried }, parked.cookie);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#e0f0ff');
    expect(html).toContain(tenantLogo.url);
  });

  it("wears the tenant's look when the client has no theme of its own", async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    const parked = await park(w, 'Forgot password?');
    await askReset(w, { return_to: parked.carried }, parked.cookie);
    expect(await mailHtmlTo(w.email)).toContain('#f1f2f3');
  });

  it("is the tenant's look for a flow with no sign-in behind it", async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    await askReset(w, {}, undefined);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#e0f0ff');
  });
});

describe('a client named by the request is never the client of a mail', () => {
  async function themedWorld(): Promise<World> {
    const w = await world();
    const otherRowId = await secondClient(w);
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    await publish(w, otherRowId, theme({ tokens: { light: OTHER_LOOK } }));
    return w;
  }

  it('ignores a return_to that names a client other than the one held', async () => {
    const w = await themedWorld();
    const parked = await park(w, 'Forgot password?');
    await askReset(w, { return_to: authorizePath(w.name, 'other') }, parked.cookie);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#ffe0f0');
    expect(html).not.toContain('#e0f0ff');
  });

  it('ignores a return_to with no held sign-in behind it', async () => {
    const w = await themedWorld();
    await askReset(w, { return_to: authorizePath(w.name, 'other') }, undefined);
    await askReset(w, { return_to: authorizePath(w.name, 'portal') }, undefined);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#e0f0ff');
  });

  it('ignores a client_id or client parameter in the body or the query', async () => {
    const w = await themedWorld();
    await request(
      'POST',
      `/tenants/${w.name}/login-actions/reset-password?client_id=other&client=other`,
      { email: w.email, client_id: 'other', client: 'other', clientId: 'other' },
    );
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#ffe0f0');
  });

  it("does not wear another tenant's client of the same name", async () => {
    const w = await world();
    const foreign = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(foreign, foreign.portalRowId, theme({ tokens: { light: OTHER_LOOK } }));
    const parked = await park(w, 'Forgot password?');
    await askReset(w, { return_to: parked.carried }, parked.cookie);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#ffe0f0');
  });

  it('does not wear a client that was disabled after the sign-in began', async () => {
    const w = await themedWorld();
    const parked = await park(w, 'Forgot password?');
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.id, w.portalRowId));
    await askReset(w, { return_to: parked.carried }, parked.cookie);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#e0f0ff');
  });

  it('does not wear a client that was deleted after the sign-in began', async () => {
    const w = await themedWorld();
    const parked = await park(w, 'Forgot password?');
    await owner.db.delete(clients).where(eq(clients.id, w.portalRowId));
    await askReset(w, { return_to: parked.carried }, parked.cookie);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#f1f2f3');
    expect(html).not.toContain('#e0f0ff');
  });
});

describe('a registration verification mail from a client sign-in', () => {
  it("wears the client's colours", async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    const parked = await park(w, 'Create an account');
    const username = `v${newId().slice(-8)}`;
    const email = `${username}@example.test`;
    const registered = await request(
      'POST',
      `/tenants/${w.name}/login-actions/registration`,
      {
        username,
        email,
        password: PASSWORD,
        password_confirm: PASSWORD,
        return_to: parked.carried,
      },
      parked.cookie,
    );
    expect(registered.statusCode).toBe(201);
    const html = await mailHtmlTo(email);
    expect(html).toContain('#e0f0ff');
    expect(html).not.toContain('#f1f2f3');
  });
});

describe('the notice an address already held is sent from a client sign-in', () => {
  it("wears the client's colours, through the same mail context as the verification mail", async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    const parked = await park(w, 'Create an account');
    const registered = await request(
      'POST',
      `/tenants/${w.name}/login-actions/registration`,
      {
        username: `d${newId().slice(-8)}`,
        email: w.email,
        password: PASSWORD,
        password_confirm: PASSWORD,
        return_to: parked.carried,
      },
      parked.cookie,
    );
    expect(registered.statusCode).toBe(201);
    const html = await mailHtmlTo(w.email);
    expect(html).toContain('#e0f0ff');
    expect(html).not.toContain('#f1f2f3');
  });
});

describe('what a client-bound reset request reveals', () => {
  async function ask(w: World, email: string, parked: Parked) {
    // The page's own theme cache is emptied, so only the mail's reads differ.
    branding.invalidateTenant(w.tenantId);
    const { result, statements } = await recorder.record(() =>
      askReset(w, { return_to: parked.carried }, parked.cookie, email),
    );
    return { result, work: statements.filter(isWork).map((s) => s.query) };
  }

  it('is the same bytes and the same statements up to the address lookup, known or not', async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: TENANT_LOOK } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    const parked = await park(w, 'Forgot password?');
    const known = await ask(w, w.email, parked);
    const unknown = await ask(w, `nobody-${newId()}@example.test`, parked);
    expect(known.result.statusCode).toBe(200);
    expect(unknown.result.statusCode).toBe(200);
    expect(unknown.result.body).toBe(known.result.body);
    expect(unknown.result.headers['content-type']).toBe(known.result.headers['content-type']);
    const lookup = (queries: string[]) =>
      queries.findIndex((q) => /from "users"/iu.test(q) && /email/iu.test(q));
    expect(lookup(known.work)).toBeGreaterThan(0);
    expect(known.work.slice(0, lookup(known.work) + 1)).toEqual(
      unknown.work.slice(0, lookup(unknown.work) + 1),
    );
    const themeReads = (queries: string[]) =>
      queries.filter((q) => /from "theme_versions"/iu.test(q)).length;
    // The page's own read, and the mail's.
    expect(themeReads(known.work)).toBe(2);
    expect(themeReads(unknown.work)).toBe(2);
  });

  it('has the same response for a client-bound request as for one with no client', async () => {
    const w = await world();
    await publish(w, w.portalRowId, theme({ tokens: { light: PORTAL_LOOK } }));
    const parked = await park(w, 'Forgot password?');
    const bound = await askReset(w, { return_to: parked.carried }, parked.cookie);
    const bare = await askReset(w, { return_to: parked.carried }, undefined);
    expect(bound.statusCode).toBe(bare.statusCode);
    expect(bound.body).toBe(bare.body);
  });
});
