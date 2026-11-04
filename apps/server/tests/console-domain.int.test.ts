import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { switchCanonical, tenantDomainRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import {
  browse,
  type ConsoleStack,
  field,
  Jar,
  KEK,
  NEW_PASSWORD,
  pathOf,
  RETURN_TO,
  seedTenantAdmin,
  startConsoleApp,
} from '#/testing/console-harness';

// A tenant administrator keeps administering a tenant whose canonical address
// is a domain: the console signs them in at that address, the admin API
// accepts what it issues, and what was issued at an address the tenant left is
// accepted for the window and not past it.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let stack: ConsoleStack;

const BASE_HOST = 'console.example.test';
const BASE = `https://${BASE_HOST}`;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
  stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
}, 120_000);

afterAll(async () => {
  await stack.app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface Tenant {
  readonly name: string;
  readonly id: string;
  readonly username: string;
}

let hostCounter = 0;

async function newTenant(): Promise<Tenant> {
  const { tenant, username } = await seedTenantAdmin();
  const rows = await owner.db.execute<{ id: string }>(
    sql`select id from tenants where name = ${tenant}`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no tenant row');
  return { name: tenant, id, username };
}

async function verifiedDomain(t: Tenant): Promise<{ host: string; id: string }> {
  const host = `d${String((hostCounter += 1))}.console-domain-tests.net`;
  const id = await withTenant(appDb.db, t.id, async (tx) => {
    const domains = tenantDomainRepository(tx);
    const row = await domains.insert({ tenantId: t.id, host, challenge: 'c' });
    await domains.markVerified(t.id, row.id, new Date());
    return row.id;
  });
  return { host, id };
}

// Points the tenant at `target` ('path' or a domain row id), as the admin API does.
async function switchTo(t: Tenant, target: string): Promise<void> {
  const outcome = await withTenant(appDb.db, t.id, (tx) =>
    switchCanonical(
      { domains: tenantDomainRepository(tx), base: BASE, tls: true },
      { id: t.id, name: t.name },
      target,
      new Date(),
    ),
  );
  expect(outcome.kind).toBe('switched');
}

async function endWindow(t: Tenant): Promise<void> {
  await owner.db.execute(
    sql`update tenant_issuer_retirements set expires_at = now() - interval '1 second' where tenant_id = ${t.id}`,
  );
}

function postAt(host: string, jar: Jar, url: string, fields: Record<string, string>) {
  return stack.app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      host,
      'x-forwarded-proto': 'https',
      'content-type': 'application/x-www-form-urlencoded',
      ...jar.header(),
    },
  });
}

// The console's own sign-in for a tenant, the browser following the redirect
// to wherever the tenant signs in. Returns the address the browser was sent to.
async function signInThroughConsole(
  jar: Jar,
  t: Tenant,
): Promise<{ authorizeAt: URL; accessToken: string }> {
  const tokensBefore = stack.tokenResponses.length;
  const login = await browse(
    stack,
    jar,
    `/console/auth/login?${new URLSearchParams({ tenant: t.name, return_to: RETURN_TO }).toString()}`,
  );
  expect(login.statusCode).toBe(302);
  const authorizeAt = new URL(String(login.headers.location));
  const prefix = authorizeAt.pathname.replace(/\/protocol\/openid-connect\/auth$/u, '');
  const page = await browse(
    stack,
    jar,
    authorizeAt.pathname + authorizeAt.search,
    authorizeAt.host,
  );
  expect(page.statusCode).toBe(200);
  const signedIn = await postAt(authorizeAt.host, jar, `${prefix}/login-actions/authenticate`, {
    auth_session_id: field(page.body, 'auth_session_id'),
    username: t.username,
    password: NEW_PASSWORD,
  });
  jar.take(signedIn);
  expect(signedIn.statusCode).toBe(302);
  const callback = await browse(stack, jar, pathOf(stack, String(signedIn.headers.location)));
  expect(callback.statusCode).toBe(302);
  const session = await browse(stack, jar, '/console/api/session');
  jar.subject = session.json<{ subject_id: string }>().subject_id;
  const issued = stack.tokenResponses.slice(tokensBefore).at(-1);
  if (issued === undefined) throw new Error('no token issued');
  const parsed: unknown = JSON.parse(issued);
  const accessToken =
    typeof parsed === 'object' && parsed !== null && 'access_token' in parsed
      ? String(parsed.access_token)
      : '';
  return { authorizeAt, accessToken };
}

function issuerOf(jwt: string): string {
  const payload: unknown = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString());
  return typeof payload === 'object' && payload !== null && 'iss' in payload
    ? String(payload.iss)
    : '';
}

function consoleWhoami(jar: Jar, t: Tenant): Promise<LightMyRequestResponse> {
  return stack.app.inject({
    url: `/console/api/admin/tenants/${t.name}/whoami`,
    headers: {
      host: BASE_HOST,
      'x-forwarded-proto': 'https',
      ...(jar.subject === undefined ? {} : { 'x-odudu-console-subject': jar.subject }),
      ...jar.header(),
    },
  });
}

function whoamiWith(t: Tenant, token: string): Promise<LightMyRequestResponse> {
  return stack.app.inject({
    url: `/admin/tenants/${t.name}/whoami`,
    headers: { host: BASE_HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${token}` },
  });
}

describe('a tenant administrator of a tenant on a canonical domain', () => {
  it('signs in at the domain and administers the tenant, with tokens issued under it', async () => {
    const t = await newTenant();
    const domain = await verifiedDomain(t);
    await switchTo(t, domain.id);

    const jar = new Jar();
    const { authorizeAt, accessToken } = await signInThroughConsole(jar, t);

    expect(authorizeAt.origin).toBe(`https://${domain.host}`);
    expect(authorizeAt.pathname).toBe('/protocol/openid-connect/auth');
    expect(issuerOf(accessToken)).toBe(`https://${domain.host}`);
    expect((await consoleWhoami(jar, t)).statusCode).toBe(200);
    expect((await whoamiWith(t, accessToken)).statusCode).toBe(200);
  });

  it('keeps a console session opened before the switch for the window, and refreshes it at the domain', async () => {
    const t = await newTenant();
    const jar = new Jar();
    const before = await signInThroughConsole(jar, t);
    expect(issuerOf(before.accessToken)).toBe(`${BASE}/tenants/${t.name}`);
    expect((await consoleWhoami(jar, t)).statusCode).toBe(200);

    const domain = await verifiedDomain(t);
    await switchTo(t, domain.id);

    expect((await whoamiWith(t, before.accessToken)).statusCode).toBe(200);
    expect((await consoleWhoami(jar, t)).statusCode).toBe(200);

    await endWindow(t);
    expect((await whoamiWith(t, before.accessToken)).statusCode).toBe(401);
    const fresh = await signInThroughConsole(new Jar(), t);
    expect((await whoamiWith(t, fresh.accessToken)).statusCode).toBe(200);
  });

  it('signs in at the path address again after switching back, and honours the domain token for the window', async () => {
    const t = await newTenant();
    const domain = await verifiedDomain(t);
    await switchTo(t, domain.id);
    const onDomain = await signInThroughConsole(new Jar(), t);

    await switchTo(t, 'path');

    expect((await whoamiWith(t, onDomain.accessToken)).statusCode).toBe(200);
    const jar = new Jar();
    const back = await signInThroughConsole(jar, t);
    expect(back.authorizeAt.origin).toBe(BASE);
    expect(back.authorizeAt.pathname).toBe(`/tenants/${t.name}/protocol/openid-connect/auth`);
    expect(issuerOf(back.accessToken)).toBe(`${BASE}/tenants/${t.name}`);
    expect((await consoleWhoami(jar, t)).statusCode).toBe(200);

    await endWindow(t);
    expect((await whoamiWith(t, onDomain.accessToken)).statusCode).toBe(401);
    expect((await whoamiWith(t, back.accessToken)).statusCode).toBe(200);
  });

  it('is refused at another tenant, whichever of its own addresses the token names', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const domain = await verifiedDomain(a);
    await switchTo(a, domain.id);
    const own = await signInThroughConsole(new Jar(), a);

    expect((await whoamiWith(a, own.accessToken)).statusCode).toBe(200);
    expect((await whoamiWith(b, own.accessToken)).statusCode).toBe(401);
  });
});
