import { MANAGE_TENANTS, TENANT_CAPABILITIES, viewCounterpart } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES, type AdminCapability, type AdminRoute } from '#/service/capability';
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

// The whole domain AdminRoute.capability draws from: the seven tenant
// capabilities plus manage-tenants, which only the system tenant's admin
// client ever holds (provisionAdminClient's `crossTenant` option).
const ALL_CAPABILITIES: readonly AdminCapability[] = [...TENANT_CAPABILITIES, MANAGE_TENANTS];

// manage-users composes view-users (provisionAdminClient's own
// viewCounterpart wiring) through role_composites, so a caller holding the
// former passes a route gated on the latter too. manage-tenants composes
// nothing and is checked by identity alone.
function admits(held: AdminCapability, required: AdminCapability): boolean {
  if (held === required) return true;
  if (held === MANAGE_TENANTS) return false;
  return viewCounterpart(held) === required;
}

// ajv validates a route's body/querystring before the router ever checks a
// capability (verified: an unauthorized POST with no body and the wrong
// capability answers 400, not 403 — packages/protocol-admin/src/adapter/
// validation.ts installs a strict compiler ahead of authorizeAdmin). Each
// entry is shaped only to satisfy that schema, never to be a business-valid
// request: what happens after authorization succeeds is not this test's
// concern, only that it is never itself a 403.
const SAMPLE_BODIES: Readonly<Partial<Record<string, unknown>>> = {
  'POST /admin/tenants/:tenant/subjects': { username: 'sample' },
  'PUT /admin/tenants/:tenant/subjects/:id/required-actions': { actions: [] },
  'PUT /admin/tenants/:tenant/subjects/:id/roles': { role_ids: [] },
  'POST /admin/tenants': { name: `sample-${newId()}` },
  'POST /admin/tenants/:tenant/clients': { client_id: `sample-${newId()}` },
  'POST /admin/tenants/:tenant/roles': { name: 'sample' },
  'POST /admin/tenants/:tenant/roles/:id/composites': { child_role_id: 'placeholder' },
  'POST /admin/tenants/:tenant/groups': { name: 'sample' },
  'PUT /admin/tenants/:tenant/groups/:id/roles': { role_ids: [] },
  'POST /admin/tenants/:tenant/scopes': { name: 'sample' },
  'PUT /admin/tenants/:tenant/scopes/:id/roles': { role_ids: [] },
  'PUT /admin/tenants/:tenant/scopes/:id/mappers': { mapper_names: [] },
  'PUT /admin/tenants/:tenant/scopes/:id/clients/:clientId': { assignment: 'default' },
  'POST /admin/tenants/:tenant/keys': { alg: 'RS256' },
  'PUT /admin/tenants/:tenant/smtp': {
    host: 'smtp.example',
    port: 587,
    from_address: 'noreply@example.com',
  },
  'POST /admin/tenants/:tenant/smtp/test': { to: 'someone@example.com' },
  'PUT /admin/tenants/:tenant/flow/executions': [],
};

function routeKey(route: AdminRoute): string {
  return `${route.method} ${route.pattern}`;
}

// ADMIN_ROUTES declares `method` as a bare `string`, but every entry is one
// of these five — the only ones `light-my-request`'s own inject signature
// accepts.
type RouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

function methodOf(route: AdminRoute): RouteMethod {
  const method = route.method;
  if (
    method === 'DELETE' ||
    method === 'GET' ||
    method === 'PATCH' ||
    method === 'POST' ||
    method === 'PUT'
  ) {
    return method;
  }
  throw new Error(`capability-matrix: unexpected HTTP method ${method}`);
}

// `tenantScopedRoutes`/`systemRoutes` are filtered to `capability !== null`,
// which `Array.prototype.filter` does not carry into the element type.
function requiredCapabilityOf(route: AdminRoute): AdminCapability {
  const capability = route.capability;
  if (capability === null) {
    throw new Error(`capability-matrix: ${routeKey(route)} declares no capability`);
  }
  return capability;
}

// Every other bodySchema in ADMIN_ROUTES (the amend* endpoints) is a
// z.record with no required key, so `{}` already satisfies it.
function bodyFor(route: AdminRoute): unknown {
  if (route.bodySchema === undefined) return undefined;
  return SAMPLE_BODIES[routeKey(route)] ?? {};
}

function urlFor(route: AdminRoute, tenantName: string): string {
  return route.pattern.replace(':tenant', tenantName).replace(/:(\w+)/gu, 'placeholder');
}

async function callWith(
  route: AdminRoute,
  url: string,
  token: string,
): Promise<LightMyRequestResponse> {
  const body = bodyFor(route);
  return fixture.http.inject({
    method: methodOf(route),
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

describe('the capability matrix', () => {
  it('has exactly one route needing authentication alone, whoami', () => {
    const nullRoutes = ADMIN_ROUTES.filter((route) => route.capability === null).map(routeKey);
    expect(nullRoutes).toEqual(['GET /admin/tenants/:tenant/whoami']);
  });

  it('admits every tenant capability to whoami, on authentication alone', async () => {
    const t = await fixture.createTenant(`m-whoami-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/whoami`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, capability).not.toBe(403);
    }
  });

  const tenantScopedRoutes = ADMIN_ROUTES.filter(
    (route) => route.capability !== null && route.pattern.includes(':tenant'),
  );

  it.each(tenantScopedRoutes)('$method $pattern admits only its own capability', async (route) => {
    const t = await fixture.createTenant(`m-${newId()}`);
    const url = urlFor(route, t.name);
    for (const capability of TENANT_CAPABILITIES) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await callWith(route, url, token);
      const permitted = admits(capability, requiredCapabilityOf(route));
      expect(res.statusCode === 403, `${capability} at ${routeKey(route)}`).toBe(!permitted);
    }
  });

  // manage-tenants held on a foreign tenant's admin client never admits a
  // route scoped to a specific capability — it only lifts the cross-tenant
  // check in authorizeAdmin, and the required-capability check still runs.
  it.each(tenantScopedRoutes)(
    '$method $pattern refuses a cross-tenant manage-tenants caller',
    async (route) => {
      const t = await fixture.createTenant(`m-cross-${newId()}`);
      const token = await fixture.systemAdminToken([MANAGE_TENANTS]);
      const res = await callWith(route, urlFor(route, t.name), token);
      expect(res.statusCode).toBe(403);
    },
  );

  // The two routes with no `:tenant` segment: the tenant collection itself,
  // reached only by a system-tenant admin holding manage-tenants.
  const systemRoutes = ADMIN_ROUTES.filter((route) => !route.pattern.includes(':tenant'));

  it.each(systemRoutes)('$method $pattern admits only manage-tenants', async (route) => {
    const url = urlFor(route, 'unused');
    for (const capability of ALL_CAPABILITIES) {
      const token = await fixture.systemAdminToken([capability]);
      const res = await callWith(route, url, token);
      const permitted = admits(capability, requiredCapabilityOf(route));
      expect(res.statusCode === 403, `${capability} at ${routeKey(route)}`).toBe(!permitted);
    }
  });
});
