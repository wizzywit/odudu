import { actionTokens } from '@odudu/account';
import { tenants, withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import { clientRepository } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixture: AdminFixture | undefined;
function on(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}
beforeAll(async () => {
  fixture = await startAdminFixture({ deploymentSmtp: true });
}, 240_000);
afterAll(async () => {
  await fixture?.stop();
});

const KINDS = [
  ['password-reset', 'reset_password', {}],
  ['verification', 'verify_email', {}],
  ['actions-email', 'execute_actions', { actions: ['configure-totp'] }],
] as const;

interface Seeded {
  readonly tenant: { id: string; name: string };
  readonly subjectId: string;
}

async function seedTenant(): Promise<Seeded> {
  const tenant = await on().createTenant(`ret-${newId()}`);
  await on()
    .owner.db.update(tenants)
    .set({ resetPasswordAllowed: true })
    .where(eq(tenants.id, tenant.id));
  const subjectId = await withTenant(on().app.db, tenant.id, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId: tenant.id, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId: tenant.id,
      username: 'ada',
      email: 'ada@example.com',
    });
    return subject.id;
  });
  return { tenant, subjectId };
}

async function createClient(tenantName: string, clientId: string, uris: string[]): Promise<void> {
  const token = await on().adminToken(tenantName, ['manage-clients']);
  const res = await on().http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { client_id: clientId, redirect_uris: uris, token_endpoint_auth_method: 'none' },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function send(
  seeded: Seeded,
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<LightMyRequestResponse> {
  const token = await on().adminToken(seeded.tenant.name, ['manage-users']);
  return on().http.inject({
    method: 'POST',
    url: `/admin/tenants/${seeded.tenant.name}/subjects/${seeded.subjectId}/${path}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body }),
  });
}

async function issued(seeded: Seeded) {
  return withTenant(on().app.db, seeded.tenant.id, (tx) =>
    tx.select().from(actionTokens).where(eq(actionTokens.subjectId, seeded.subjectId)),
  );
}

async function queued(seeded: Seeded): Promise<number> {
  return (await withTenant(on().app.db, seeded.tenant.id, (tx) => tx.select().from(emailOutbox)))
    .length;
}

function problemOf(res: LightMyRequestResponse): string {
  return res.json<{ type: string }>().type;
}

describe.each(KINDS)('POST …/%s naming a client to return to', (path, type, base) => {
  it('stores the client and its one registered address on the link, and audits the client', async () => {
    const seeded = await seedTenant();
    await createClient(seeded.tenant.name, 'spa', ['https://app.example/after']);
    const res = await send(seeded, path, { ...base, client_id: 'spa' });
    expect(res.statusCode, res.body).toBe(202);
    const clientDbId = await withTenant(on().app.db, seeded.tenant.id, async (tx) => {
      return (await clientRepository(tx).byClientId('spa'))?.id;
    });
    const [row] = await issued(seeded);
    expect(row).toMatchObject({
      type,
      clientId: clientDbId,
      returnUri: 'https://app.example/after',
    });
    const audit = await withTenant(on().app.db, seeded.tenant.id, (tx) =>
      auditRepository(tx).list({ resourceId: seeded.subjectId, limit: 5 }),
    );
    expect(audit[0]?.detail).toMatchObject({ client_id: 'spa' });
  });

  it('needs the address named when the client registers several, and takes only a registered one', async () => {
    const seeded = await seedTenant();
    await createClient(seeded.tenant.name, 'multi', [
      'https://app.example/a',
      'https://app.example/b',
    ]);
    const missing = await send(seeded, path, { ...base, client_id: 'multi' });
    expect(missing.statusCode).toBe(400);
    expect(problemOf(missing)).toBe('about:blank#return-redirect-uri-required');
    const strange = await send(seeded, path, {
      ...base,
      client_id: 'multi',
      redirect_uri: 'https://app.example/a/',
    });
    expect(strange.statusCode).toBe(400);
    expect(problemOf(strange)).toBe('about:blank#return-redirect-uri-unregistered');
    expect(await issued(seeded)).toEqual([]);
    expect(await queued(seeded)).toBe(0);

    const named = await send(seeded, path, {
      ...base,
      client_id: 'multi',
      redirect_uri: 'https://app.example/b',
    });
    expect(named.statusCode, named.body).toBe(202);
    expect((await issued(seeded))[0]?.returnUri).toBe('https://app.example/b');
  });

  it('refuses a client of another tenant, and a disabled one, queueing nothing', async () => {
    const seeded = await seedTenant();
    const other = await seedTenant();
    await createClient(other.tenant.name, 'theirs', ['https://theirs.example/cb']);
    const foreign = await send(seeded, path, { ...base, client_id: 'theirs' });
    expect(foreign.statusCode).toBe(400);
    expect(problemOf(foreign)).toBe('about:blank#return-client-unknown');

    await createClient(seeded.tenant.name, 'off', ['https://app.example/cb']);
    const id = await withTenant(on().app.db, seeded.tenant.id, async (tx) => {
      return (await clientRepository(tx).byClientId('off'))?.id;
    });
    await on().patchClient(seeded.tenant.name, id ?? '', { enabled: false });
    const disabled = await send(seeded, path, { ...base, client_id: 'off' });
    expect(problemOf(disabled)).toBe('about:blank#return-client-unknown');
    expect(await issued(seeded)).toEqual([]);
    expect(await issued(other)).toEqual([]);
    expect(await queued(seeded)).toBe(0);
  });

  it('refuses a redirect_uri with no client_id, naming the field', async () => {
    const seeded = await seedTenant();
    const res = await send(seeded, path, { ...base, redirect_uri: 'https://app.example/after' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('redirect_uri');
    expect(await queued(seeded)).toBe(0);
  });

  it('refuses a field it does not know with 400, naming it', async () => {
    const seeded = await seedTenant();
    const res = await send(seeded, path, { ...base, return_to: 'https://app.example/after' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('return_to');
    expect(await queued(seeded)).toBe(0);
  });

  it('keeps a request that names no client as it was: no columns set, no body needed', async () => {
    const seeded = await seedTenant();
    const res = await send(seeded, path, path === 'actions-email' ? base : undefined);
    expect(res.statusCode, res.body).toBe(202);
    expect(res.body).toBe('');
    expect((await issued(seeded)).map((row) => [row.clientId, row.returnUri])).toEqual([
      [null, null],
    ]);
  });
});
