import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { clientRepository, clientScopeRepository } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { desc, eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// The three actions that ask more of a person, through the real app: owed by
// the tenant, then asked for by an application, with the mail they send.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const REDIRECT = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple 1!';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const TERMS = 'https://example.com/terms';

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
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    deploymentSmtp: true,
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
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly email: string;
}

interface Options {
  readonly owes?: readonly string[];
  readonly verified?: boolean;
  readonly terms?: string | null;
  readonly termsVersion?: string;
  readonly allowed?: readonly string[];
}

async function world(options: Options = {}): Promise<World> {
  const name = `more-${newId()}`;
  const email = `ada-${newId().slice(-10)}@example.com`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT],
    username: 'ada',
    password: PASSWORD,
    email,
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  await withTenant(appDb.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId('portal');
    if (client === null) throw new Error('no client');
    for (const scope of await clientScopeRepository(tx).byNames(['me:read'])) {
      await clientScopeRepository(tx).assign(client.id, scope.id, 'optional');
    }
  });
  await owner.sql`
    update client_oidc_config
       set audiences = ${[meAudienceOfIssuer(`${BASE}/tenants/${name}`)]},
           allowed_actions = ${[...(options.allowed ?? ['verify-email', 'update-profile'])]}
     where tenant_id = ${tenantId}`;
  await owner.sql`update tenants set terms_uri = ${options.terms ?? null},
                  terms_version = ${options.termsVersion ?? '1'} where id = ${tenantId}`;
  if (options.verified === true) {
    await owner.sql`update users set email_verified = true where subject_id = ${seeded.userSubjectId}`;
  }
  for (const action of options.owes ?? []) {
    await owner.sql`insert into user_required_actions (tenant_id, subject_id, action)
                    values (${tenantId}, ${seeded.userSubjectId}, ${action})`;
  }
  return {
    name,
    tenantId,
    issuer: `${BASE}/tenants/${name}`,
    subjectId: seeded.userSubjectId,
    email,
  };
}

function authorizeUrl(w: World, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT,
    scope: 'openid me:read',
    resource: meAudienceOfIssuer(w.issuer),
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${w.name}/protocol/openid-connect/auth?${query.toString()}`;
}

const authorize = (w: World, extra: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: authorizeUrl(w, extra), headers: { host: HOST } });

function field(res: LightMyRequestResponse, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(res.body)?.[1];
  if (value === undefined) throw new Error(`no ${name} field: ${res.body.slice(0, 300)}`);
  return value;
}

const form = (w: World, path: string, fields: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/login-actions/${path}`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });

// The first page after the password: whatever the sign-in owes next.
async function signIn(
  w: World,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const login = await authorize(w, extra);
  expect(login.statusCode).toBe(200);
  return form(w, 'authenticate', {
    auth_session_id: field(login, 'auth_session_id'),
    username: 'ada',
    password: PASSWORD,
  });
}

const act = (
  w: World,
  page: LightMyRequestResponse,
  action: string,
  fields: Record<string, string> = {},
) =>
  form(w, `required-action?action=${action}`, {
    auth_session_id: field(page, 'auth_session_id'),
    ...fields,
  });

const redirectedTo = (res: LightMyRequestResponse): URL => {
  expect(res.statusCode).toBe(302);
  return new URL(String(res.headers.location));
};

const owed = async (w: World): Promise<string[]> =>
  (
    await owner.sql<{ action: string }[]>`
      select action from user_required_actions where subject_id = ${w.subjectId} order by action`
  ).map((row) => row.action);

const FILLED: Record<string, string> = {
  name: 'Ada Lovelace',
  given_name: 'Ada',
  family_name: 'Lovelace',
  middle_name: 'Augusta',
  nickname: 'ada',
  preferred_username: 'ada',
  profile: 'https://example.com/ada',
  picture: 'https://example.com/ada.png',
  website: 'https://example.com',
  gender: 'female',
  birthdate: '1815-12-10',
  zoneinfo: 'Europe/London',
  locale: 'en-GB',
  phone_number: '+442071838750',
  address_formatted: '12 St James Square, London',
  address_street: '12 St James Square',
  address_locality: 'London',
  address_region: 'Greater London',
  address_postal_code: 'SW1Y 4LB',
  address_country: 'GB',
};

async function mailedLink(w: World): Promise<string> {
  const rows = await owner.db
    .select({ text: emailOutbox.bodyText })
    .from(emailOutbox)
    .where(eq(emailOutbox.toAddress, w.email))
    .orderBy(desc(emailOutbox.createdAt));
  const link = /https:\/\/id\.example\.com(\S+)/u.exec(rows[0]?.text ?? '')?.[1];
  if (link === undefined) throw new Error('no link in the mail');
  return link;
}

const mailCount = async (w: World): Promise<number> =>
  (await owner.db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, w.email))).length;

describe('verify-email, owed by the tenant', () => {
  it('shows the address and no way out, and stays owed while it is not verified', async () => {
    const w = await world({ owes: ['verify-email'] });
    const page = await signIn(w);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Verify your email address');
    expect(page.body).toContain(w.email);
    expect(page.body).not.toContain('name="cancel"');
    expect(page.body).toContain('login-actions/required-action?action=verify-email');

    const again = await act(w, page, 'verify-email');
    expect(again.statusCode).toBe(200);
    expect(again.body).toContain('not verified yet');
    expect(await owed(w)).toEqual(['verify-email']);
  });

  it('mails the link when asked, once per budget, and completes when the link is used', async () => {
    const w = await world({ owes: ['verify-email'] });
    const page = await signIn(w);
    expect(await mailCount(w)).toBe(0);

    const sent = await act(w, page, 'verify-email', { send: '1' });
    expect(sent.statusCode).toBe(200);
    expect(sent.body).toContain('We sent a link to this address');
    expect(await mailCount(w)).toBe(1);

    const link = await mailedLink(w);
    const confirm = await app.inject({ method: 'GET', url: link, headers: { host: HOST } });
    expect(confirm.statusCode).toBe(200);
    const used = await app.inject({
      method: 'POST',
      url: String(/action="([^"]*)"/u.exec(confirm.body)?.[1]).replace(/&amp;/gu, '&'),
      headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(
        [...confirm.body.matchAll(/name="([a-z_]+)" value="([^"]*)"/gu)].map(
          (m): [string, string] => [m[1] ?? '', m[2] ?? ''],
        ),
      ).toString(),
    });
    expect(used.statusCode).toBe(200);
    expect(await owed(w)).toEqual([]);

    // The sign-in that was waiting carries on without a page of its own.
    const done = await act(w, page, 'verify-email');
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
  });

  it('holds a fourth link back inside the hour, and says so', async () => {
    const w = await world({ owes: ['verify-email'] });
    const page = await signIn(w);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await act(w, page, 'verify-email', { send: '1' })).body).toContain(
        'We sent a link to this address',
      );
    }
    const fourth = await act(w, page, 'verify-email', { send: '1' });
    expect(fourth.statusCode).toBe(200);
    expect(fourth.body).toContain('Links have been sent to this address several times already');
    expect(await mailCount(w)).toBe(3);
  });

  it('completes on “I have verified it” once the address is proved some other way', async () => {
    const w = await world({ owes: ['verify-email'] });
    const page = await signIn(w);
    await owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;
    const done = await act(w, page, 'verify-email');
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
    expect(await owed(w)).toEqual([]);
  });

  it('is no page at all for an address that is already verified', async () => {
    const w = await world({ owes: ['verify-email'], verified: true });
    const done = await signIn(w);
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
    expect(await owed(w)).toEqual([]);
  });

  it('is asked before a password change', async () => {
    const w = await world({ owes: ['update-password', 'verify-email'] });
    const page = await signIn(w);
    expect(page.body).toContain('Verify your email address');
    const skipped = await act(w, page, 'update-password', { password: 'a new password 1!' });
    expect(skipped.statusCode).toBe(400);
  });
});

describe('update-profile, owed by the tenant', () => {
  it('lists the editable fields with what is held, and completes when every empty one is filled', async () => {
    const w = await world({ owes: ['update-profile'] });
    const page = await signIn(w);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Complete your profile');
    for (const name of Object.keys(FILLED)) expect(page.body).toContain(`name="${name}"`);
    expect(page.body).not.toContain('name="email"');
    expect(page.body).not.toContain('name="cancel"');

    const done = await act(w, page, 'update-profile', { ...FILLED, email: 'other@example.com' });
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
    expect(await owed(w)).toEqual([]);
    const [row] = await owner.sql<{ birthdate: string; email: string }[]>`
      select birthdate, email from users where subject_id = ${w.subjectId}`;
    expect(row).toEqual({ birthdate: '1815-12-10', email: w.email });
  });

  it('comes back with an alert and what was typed while a field is empty', async () => {
    const w = await world({ owes: ['update-profile'] });
    const page = await signIn(w);
    const rest = Object.fromEntries(
      Object.entries(FILLED).filter(([name]) => name !== 'birthdate'),
    );
    const refused = await act(w, page, 'update-profile', rest);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('role="alert"');
    expect(refused.body).toContain('Fill in every field.');
    expect(refused.body).toContain('value="Ada Lovelace"');
    expect(await owed(w)).toEqual(['update-profile']);
  });

  it('refuses a value the me API would refuse, naming the field', async () => {
    const w = await world({ owes: ['update-profile'] });
    const page = await signIn(w);
    const refused = await act(w, page, 'update-profile', { ...FILLED, birthdate: 'yesterday' });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('Birthdate must be a date');
    expect(await owed(w)).toEqual(['update-profile']);
  });
});

describe('accept-terms, owed by the tenant', () => {
  it('links the terms, needs the box, records the version and clears the action', async () => {
    const w = await world({ owes: ['accept-terms'], terms: TERMS, termsVersion: '2026-01' });
    const page = await signIn(w);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`href="${TERMS}" rel="noopener noreferrer" target="_blank"`);
    expect(page.body).toContain('2026-01');
    expect(page.body).not.toContain('name="cancel"');

    const refused = await act(w, page, 'accept-terms');
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('Tick the box');
    expect(await owed(w)).toEqual(['accept-terms']);

    const done = await act(w, page, 'accept-terms', { accept: 'true' });
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
    expect(await owed(w)).toEqual([]);
    const accepted = await owner.sql<{ version: string }[]>`
      select version from subject_terms_acceptances where subject_id = ${w.subjectId}`;
    expect(accepted).toEqual([{ version: '2026-01' }]);
  });

  it('is cleared, with no page, where the tenant has no terms', async () => {
    const w = await world({ owes: ['accept-terms'] });
    const done = await signIn(w);
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
    expect(await owed(w)).toEqual([]);
  });

  it('is cleared for a version already accepted, and asked again for a new one when owed', async () => {
    const w = await world({ owes: ['accept-terms'], terms: TERMS });
    await owner.sql`insert into subject_terms_acceptances (tenant_id, subject_id, version)
                    values (${w.tenantId}, ${w.subjectId}, '1')`;
    expect(redirectedTo(await signIn(w)).searchParams.get('code')).toBeTruthy();

    await owner.sql`update tenants set terms_version = '2' where id = ${w.tenantId}`;
    expect(redirectedTo(await signIn(w)).searchParams.get('code')).toBeTruthy();
    await owner.sql`insert into user_required_actions (tenant_id, subject_id, action)
                    values (${w.tenantId}, ${w.subjectId}, 'accept-terms')`;
    expect((await signIn(w)).body).toContain('Accept the terms');
  });

  it('is the last of the three, after the profile', async () => {
    const w = await world({
      owes: ['accept-terms', 'update-profile', 'verify-email'],
      terms: TERMS,
    });
    const first = await signIn(w);
    expect(first.body).toContain('Verify your email address');
    await owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;
    const second = await act(w, first, 'verify-email');
    expect(second.body).toContain('Complete your profile');
    const early = await act(w, second, 'accept-terms', { accept: 'true' });
    expect(early.statusCode).toBe(400);
    const third = await act(w, second, 'update-profile', FILLED);
    expect(third.body).toContain('Accept the terms');
    const done = await act(w, third, 'accept-terms', { accept: 'true' });
    expect(redirectedTo(done).searchParams.get('code')).toBeTruthy();
  });
});

describe('an application starting an action', () => {
  it('shows the address page with a cancel control, and ends in success when it is verified', async () => {
    const w = await world();
    const page = await signIn(w, { action: 'verify-email' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="cancel"');
    expect(page.body).toContain('An application asked you to confirm');

    await owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;
    const done = await act(w, page, 'verify-email');
    expect(redirectedTo(done).searchParams.get('action_status')).toBe('success');
  });

  it('can be left, ending in cancelled', async () => {
    const w = await world();
    const page = await signIn(w, { action: 'update-profile' });
    expect(page.body).toContain('name="cancel"');
    const done = await act(w, page, 'update-profile', { cancel: '1' });
    expect(redirectedTo(done).searchParams.get('action_status')).toBe('cancelled');
    expect(await owed(w)).toEqual([]);
  });

  it('completes the profile and ends in success', async () => {
    const w = await world();
    const page = await signIn(w, { action: 'update-profile' });
    const done = await act(w, page, 'update-profile', FILLED);
    expect(redirectedTo(done).searchParams.get('action_status')).toBe('success');
  });

  it('refuses the tenant’s own terms, even for a client that lists them', async () => {
    const w = await world({ terms: TERMS });
    await owner.sql`update client_oidc_config set allowed_actions = '{}' where tenant_id = ${w.tenantId}`;
    const res = await authorize(w, { action: 'accept-terms' });
    const target = redirectedTo(res);
    expect(target.searchParams.get('error')).toBe('invalid_request');
    expect(target.searchParams.has('code')).toBe(false);
  });

  it('refuses an address page for a person with no address, saying it failed', async () => {
    const w = await world();
    await owner.sql`update users set email = null where subject_id = ${w.subjectId}`;
    const res = await signIn(w, { action: 'verify-email' });
    expect(res.statusCode).toBe(400);
  });
});
