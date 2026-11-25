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
  seedTenantAdmin,
  startConsoleApp,
} from '#/testing/console-harness';

// A person with no session who opens an approval link signs in through the
// console and comes back to the approval page at the tenant's own address:
// the path on the base for a tenant on a path, the canonical domain for one on
// a domain, and nothing a request names ever chooses the host.

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

async function approvalFor(t: Tenant): Promise<string> {
  const id = newId();
  await owner.db.execute(sql`
    insert into agent_approvals
      (id, tenant_id, subject_id, requesting_client_id, instance_id, kind, summary, action_digest, expires_at)
    select ${id}, c.tenant_id, u.subject_id, c.id, null, 'ciba',
           'Calendar asks to sign in as you', ${'a'.repeat(64)}, now() + interval '10 minutes'
      from clients c join users u on u.tenant_id = c.tenant_id
     where c.tenant_id = ${t.id} and c.client_id = 'odudu-admin' and u.username = ${t.username}`);
  return id;
}

const pathFor = (t: Tenant, id: string): string => `/tenants/${t.name}/approval/${id}`;

// The console's sign-in with `returnTo`, the browser following the redirect to
// wherever the tenant signs in. Answers the callback response, whose location
// is where the browser is sent back to.
async function signInReturningTo(
  jar: Jar,
  t: Tenant,
  returnTo: string,
): Promise<LightMyRequestResponse> {
  const login = await browse(
    stack,
    jar,
    `/console/auth/login?${new URLSearchParams({ tenant: t.name, return_to: returnTo }).toString()}`,
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
  return callback;
}

describe('the approval link of a tenant on a path', () => {
  it('sends a person with no session to the console sign-in, and back to the approval page, which then shows', async () => {
    const t = await newTenant();
    const id = await approvalFor(t);
    const jar = new Jar();
    const first = await browse(stack, jar, pathFor(t, id));
    expect(first.statusCode).toBe(302);
    const toSignIn = new URL(String(first.headers.location));
    expect(toSignIn.origin).toBe(BASE);
    expect(toSignIn.pathname).toBe('/console/auth/login');
    expect(toSignIn.searchParams.get('tenant')).toBe(t.name);
    expect(toSignIn.searchParams.get('return_to')).toBe(pathFor(t, id));

    const callback = await signInReturningTo(
      jar,
      t,
      String(toSignIn.searchParams.get('return_to')),
    );
    expect(callback.headers.location).toBe(pathFor(t, id));
    const page = await browse(stack, jar, String(callback.headers.location));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Calendar');
    expect(page.body).toContain('value="approve"');
  });
});

describe('the approval link of a tenant on a domain of its own', () => {
  it('has no session on the domain, signs in through the console, and returns to the canonical domain', async () => {
    const t = await newTenant();
    const domain = await verifiedDomain(t);
    await switchTo(t, domain.id);
    const id = await approvalFor(t);
    const jar = new Jar();

    const first = await browse(stack, jar, `/approval/${id}`, domain.host);
    expect(first.statusCode).toBe(302);
    const toSignIn = new URL(String(first.headers.location));
    expect(toSignIn.origin).toBe(BASE);
    expect(toSignIn.pathname).toBe('/console/auth/login');

    const callback = await signInReturningTo(
      jar,
      t,
      String(toSignIn.searchParams.get('return_to')),
    );
    expect(callback.headers.location).toBe(`https://${domain.host}/approval/${id}`);
    const page = await browse(stack, jar, `/approval/${id}`, domain.host);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('value="approve"');
  });

  it('maps to the canonical domain the tenant has now, and to the path once it has left every domain', async () => {
    const t = await newTenant();
    const first = await verifiedDomain(t);
    const second = await verifiedDomain(t);
    await switchTo(t, first.id);
    await switchTo(t, second.id);
    const id = await approvalFor(t);
    const toSecond = await signInReturningTo(new Jar(), t, pathFor(t, id));
    expect(toSecond.headers.location).toBe(`https://${second.host}/approval/${id}`);

    await switchTo(t, 'path');
    const toPath = await signInReturningTo(new Jar(), t, pathFor(t, id));
    expect(toPath.headers.location).toBe(pathFor(t, id));
  });

  it('refuses every other destination a request may name', async () => {
    const t = await newTenant();
    const other = await newTenant();
    const domain = await verifiedDomain(t);
    await switchTo(t, domain.id);
    const id = await approvalFor(t);
    const otherId = await approvalFor(other);
    for (const returnTo of [
      `https://evil.example/approval/${id}`,
      `//evil.example/approval/${id}`,
      `/tenants/${t.name}/approval/${id}/x`,
      `/tenants/${other.name}/approval/${otherId}`,
    ]) {
      const callback = await signInReturningTo(new Jar(), t, returnTo);
      expect(callback.headers.location, returnTo).toBe('/console/');
    }
  });
});
