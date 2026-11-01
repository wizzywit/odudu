import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant, tenants } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createBranding } from '#/branding';
import { seed } from '#/cli/seed';

// The real composition root, a real PostgreSQL and the real renderers: a
// page asks for its theme, and a theme that cannot be used leaves the
// default page and one log line.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
const lines: Record<string, unknown>[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';

const SIGN_IN = (marker: string): string =>
  `<div class="${marker}">{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>`;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: pino(
      { level: 'warn' },
      {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    ),
    tls: false,
    publicBaseUrl: BASE,
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
  clientUuid: (clientId: string) => Promise<string>;
}

async function world(clientIds: string[]): Promise<World> {
  const name = `brand-${newId()}`;
  let tenantId = '';
  for (const clientId of clientIds) {
    const seeded = await seed({
      tenant: name,
      clientId,
      redirectUris: [REDIRECT_URI],
      ...(tenantId === '' ? { username: 'user', password: PASSWORD } : {}),
    });
    tenantId = seeded.tenantId;
  }
  await owner.db
    .update(tenants)
    .set({ registrationAllowed: true, resetPasswordAllowed: true })
    .where(eq(tenants.id, tenantId));
  return {
    name,
    tenantId,
    clientUuid: async (clientId) => {
      const [row] = await owner.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, clientId)));
      if (row === undefined) throw new Error('no such client');
      return row.id;
    },
  };
}

function body(templates: ThemeBody['templates']): ThemeBody {
  return { tokens: {}, stylesheet: null, templates, assets: {} };
}

async function publish(
  tenantId: string,
  clientId: string | null,
  themeBody: ThemeBody,
  options: { publish: boolean } = { publish: true },
): Promise<void> {
  await withTenant(appDb.db, tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId, clientId };
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
    if (options.publish) await themes.publish(scope);
  });
}

async function authorize(tenant: string, clientId: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return app.inject({
    url: `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

describe('a page asks for its theme', () => {
  it('shows the tenant template on sign-in, with its stylesheet allowed by the policy', async () => {
    const w = await world(['portal']);
    await publish(w.tenantId, null, {
      ...body({ 'sign-in': SIGN_IN('themed-tenant') }),
      tokens: {
        font: 'IBM Plex Mono',
      },
    });
    const page = await authorize(w.name, 'portal');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('class="themed-tenant"');
    const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1];
    expect(sheet).toMatch(new RegExp(`^/tenants/${w.name}/brand/[0-9a-f]{64}\\.css$`, 'u'));
    expect(String(page.headers['content-security-policy'])).toContain(`${BASE}${sheet ?? ''}`);
    expect(page.body).toContain('name="auth_session_id"');
  });

  it('serves a stylesheet-only theme a page-<kind> hook to style the page by', async () => {
    const w = await world(['portal']);
    await publish(w.tenantId, null, {
      ...body({}),
      stylesheet: '.page-sign-in { letter-spacing: 0.02em; }',
    });
    const page = await authorize(w.name, 'portal');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<main class="page page-sign-in">');
    const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1];
    const css = await app.inject({ url: sheet ?? '/missing' });
    expect(css.statusCode).toBe(200);
    expect(css.body).toContain('.page-sign-in');
  });

  it('leaves a tenant with no theme on the default page', async () => {
    const w = await world(['portal']);
    const page = await authorize(w.name, 'portal');
    expect(page.body).not.toContain('themed-');
    expect(page.body).toContain('<main class="page">');
    expect(page.body).toContain('name="auth_session_id"');
  });

  it('never renders a draft', async () => {
    const w = await world(['portal']);
    await publish(w.tenantId, null, body({ 'sign-in': SIGN_IN('themed-draft') }), {
      publish: false,
    });
    expect((await authorize(w.name, 'portal')).body).not.toContain('themed-draft');
  });

  it("takes the client's template for that client and the tenant's for another", async () => {
    const w = await world(['portal', 'other']);
    await publish(w.tenantId, null, body({ 'sign-in': SIGN_IN('themed-tenant') }));
    await publish(
      w.tenantId,
      await w.clientUuid('portal'),
      body({ 'sign-in': SIGN_IN('themed-client') }),
    );
    expect((await authorize(w.name, 'portal')).body).toContain('themed-client');
    expect((await authorize(w.name, 'other')).body).toContain('themed-tenant');
  });

  it('a template that cannot be filled shows the default page and logs one line', async () => {
    const w = await world(['portal']);
    await publish(
      w.tenantId,
      null,
      body({ 'sign-in': `<p>{{t "no.such.key"}}</p>${SIGN_IN('themed-broken')}` }),
    );
    lines.length = 0;
    const first = await authorize(w.name, 'portal');
    const second = await authorize(w.name, 'portal');
    for (const page of [first, second]) {
      expect(page.statusCode).toBe(200);
      expect(page.body).not.toContain('themed-broken');
      expect(page.body).toContain('name="auth_session_id"');
    }
    const heard = lines.filter((line) => String(line.msg).includes('could not be filled'));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: 'sign-in', scope: `${w.tenantId}:portal:1.0` });
  });

  it('a stored template with an unknown part is refused at fill and logged once', async () => {
    const w = await world(['portal']);
    await publish(w.tenantId, null, body({ 'sign-in': `{{nonsense}}${SIGN_IN('themed-broken')}` }));
    lines.length = 0;
    const first = await authorize(w.name, 'portal');
    await authorize(w.name, 'portal');
    expect(first.body).not.toContain('themed-broken');
    expect(lines.filter((line) => String(line.msg).includes('could not be filled'))).toHaveLength(
      1,
    );
  });

  it('themes account pages by the client a return_to names, never a foreign one', async () => {
    const w = await world(['portal']);
    const other = await world(['rival']);
    const registration = (marker: string): string =>
      `<div class="${marker}">{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>`;
    await publish(w.tenantId, null, body({ registration: registration('reg-tenant') }));
    await publish(
      w.tenantId,
      await w.clientUuid('portal'),
      body({ registration: registration('reg-client') }),
    );
    await publish(
      other.tenantId,
      await other.clientUuid('rival'),
      body({ registration: registration('reg-rival') }),
    );
    const at = async (returnTo: string | null) =>
      (
        await app.inject({
          url:
            `/tenants/${w.name}/login-actions/registration` +
            (returnTo === null
              ? ''
              : `?${new URLSearchParams({ return_to: returnTo }).toString()}`),
        })
      ).body;
    const authorizePath = (tenant: string, clientId: string): string =>
      `/tenants/${tenant}/protocol/openid-connect/auth?client_id=${clientId}&response_type=code`;
    expect(await at(authorizePath(w.name, 'portal'))).toContain('reg-client');
    expect(await at(null)).toContain('reg-tenant');
    expect(await at(authorizePath(w.name, 'nobody'))).toContain('reg-tenant');
    expect(await at(authorizePath(w.name, 'rival'))).toContain('reg-tenant');
    expect(await at(authorizePath(w.name, 'rival'))).not.toContain('reg-rival');
  });

  it('themes the pages the consent and required-action routes answer with', async () => {
    const w = await world(['portal']);
    await publish(
      w.tenantId,
      null,
      body({ 'authorize-error': '<div class="err-themed">{{message}}</div>' }),
    );
    const post = (url: string, fields: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: `/tenants/${w.name}/login-actions/${url}`,
        payload: new URLSearchParams({ auth_session_id: newId(), ...fields }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    expect((await post('consent', { decision: 'allow' })).body).toContain('err-themed');
    expect(
      (await post('required-action?action=update-password', { password: 'x' })).body,
    ).toContain('err-themed');
  });

  it('themes the logout pages with the tenant theme', async () => {
    const w = await world(['portal']);
    await publish(
      w.tenantId,
      null,
      body({ 'logged-out': '<div class="out-tenant">{{message}}{{frames}}{{script}}</div>' }),
    );
    const page = await app.inject({
      url: `/tenants/${w.name}/protocol/openid-connect/logout`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('out-tenant');
  });
});

describe('createBranding', () => {
  it('publishing invalidates the entry in this process', async () => {
    const w = await world(['portal']);
    const branding = createBranding({
      database: appDb,
      logger: pino({ level: 'silent' }),
      publicBaseUrl: BASE,
    });
    const ask = () =>
      branding.resolveBranding({ tenantId: w.tenantId, tenantName: w.name, clientId: null });
    expect(await ask()).toBeNull();
    await publish(w.tenantId, null, body({ 'sign-in': SIGN_IN('themed-late') }));
    expect(await ask()).toBeNull();
    branding.invalidateTenant(w.tenantId);
    expect((await ask())?.branding.templates['sign-in']).toContain('themed-late');
  });

  it('knows a registered client of the tenant and no other', async () => {
    const w = await world(['portal']);
    const other = await world(['rival']);
    const branding = createBranding({
      database: appDb,
      logger: pino({ level: 'silent' }),
      publicBaseUrl: BASE,
    });
    expect(await branding.isClientOfTenant(w.tenantId, 'portal')).toBe(true);
    expect(await branding.isClientOfTenant(w.tenantId, 'rival')).toBe(false);
    expect(await branding.isClientOfTenant(other.tenantId, 'rival')).toBe(true);
  });
});
