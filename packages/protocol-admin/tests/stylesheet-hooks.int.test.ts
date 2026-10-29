import {
  CSS_ELEMENTS,
  CSS_HOOKS,
  CSS_HOOKS_VERSION,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  CSS_TOKENS,
} from '@odudu/domain-theme';
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

function hooks(ctx: Ctx, token = ctx.token): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${ctx.tenant.name}/theme/stylesheet-hooks`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /theme/stylesheet-hooks', () => {
  it('answers what the stylesheet checker accepts, with the version', async () => {
    const res = await hooks(await tenantCtx());
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      version: number;
      classes: string[];
      page_kind_classes: string[];
      elements: string[];
      pseudo_classes: string[];
      pseudo_elements: string[];
      tokens: string[];
    }>();
    expect(body.version).toBe(CSS_HOOKS_VERSION);
    expect([...body.classes, ...body.page_kind_classes]).toEqual(CSS_HOOKS);
    expect(body.elements).toEqual(CSS_ELEMENTS);
    expect(body.pseudo_classes).toEqual(CSS_PSEUDO_CLASSES);
    expect(body.pseudo_elements).toEqual(CSS_PSEUDO_ELEMENTS);
    expect(body.tokens).toEqual(CSS_TOKENS);
  });

  it('is the same for every tenant', async () => {
    const [a, b] = [await tenantCtx(), await tenantCtx()];
    expect((await hooks(a)).body).toBe((await hooks(b)).body);
  });

  it('is declared manage-tenant, also admitting manage-clients', async () => {
    const route = ADMIN_ROUTES.find(
      (entry) => entry.pattern === '/admin/tenants/:tenant/theme/stylesheet-hooks',
    );
    expect(route?.capability).toBe('manage-tenant');
    expect(route?.alsoAdmits).toEqual(['manage-clients']);
    const clients = await tenantCtx(['manage-clients']);
    expect((await hooks(clients)).statusCode).toBe(200);
  });

  it('is refused without a token and without either capability', async () => {
    const readOnly = await tenantCtx(['view-users']);
    const anonymous = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${readOnly.tenant.name}/theme/stylesheet-hooks`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await hooks(readOnly)).statusCode).toBe(403);
  });

  it('refuses another tenant’s token exactly as it refuses a tenant that does not exist', async () => {
    const mine = await tenantCtx();
    const theirs = await tenantCtx();
    const foreign = await hooks({ ...mine, tenant: theirs.tenant });
    const missing = await hooks({
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
