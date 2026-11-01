import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Ctx {
  tenant: { id: string; name: string };
  token: string;
}

async function tenantCtx(capabilities: string[] = ['manage-tenant']): Promise<Ctx> {
  const tenant = await fixture.createTenant(`acme-${newId()}`);
  return { tenant, token: await fixture.adminToken(tenant.name, capabilities) };
}

function catalogue(ctx: Ctx, token = ctx.token): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${ctx.tenant.name}/message-catalogue`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /message-catalogue', () => {
  it('lists the keys a template or an override may name, with their English text', async () => {
    const ctx = await tenantCtx();
    const res = await catalogue(ctx);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      sections: { kinds: string[]; messages: { key: string; en: string }[] }[];
    }>();
    const messages = body.sections.flatMap((section) => section.messages);
    expect(messages).toContainEqual({ key: 'login.title', en: expect.any(String) as string });
    for (const message of messages) expect(message.en).not.toBe('');
  });

  it('is the same for every tenant', async () => {
    const [a, b] = [await tenantCtx(), await tenantCtx()];
    expect((await catalogue(a)).body).toBe((await catalogue(b)).body);
  });

  it('is declared manage-tenant and nothing else admits it', () => {
    const route = ADMIN_ROUTES.find(
      (entry) => entry.pattern === '/admin/tenants/:tenant/message-catalogue',
    );
    expect(route?.capability).toBe('manage-tenant');
    expect(route?.alsoAdmits ?? []).toEqual([]);
  });

  it('is refused without a token and without manage-tenant', async () => {
    const readOnly = await tenantCtx(['view-users', 'manage-clients']);
    const anonymous = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${readOnly.tenant.name}/message-catalogue`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await catalogue(readOnly)).statusCode).toBe(403);
  });

  it('refuses another tenant’s token exactly as it refuses a tenant that does not exist', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    const foreign = await catalogue({ ...mine, tenant: theirs.tenant });
    const missing = await catalogue({
      ...mine,
      tenant: { id: newId(), name: `nonesuch-${newId()}` },
    });
    expect(foreign.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body.replace(/"instance":"[^"]*"/u, '')).toBe(
      missing.body.replace(/"instance":"[^"]*"/u, ''),
    );
  });
});
