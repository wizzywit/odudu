import {
  MANAGE_TENANTS,
  TENANT_CAPABILITIES,
  viewCounterpart,
  type TenantCapability,
} from '@odudu/domain-tenant';
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
// capability answers 400, not 403 — validation.ts installs a strict
// compiler ahead of authorizeAdmin). Skip this and an authorization test on
// a write route reads as the route itself being broken. Each entry only
// satisfies the schema, never a business-valid request — what happens after
// authorization succeeds is not this test's concern, only that it is never
// itself a 403.
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

// `tenantScopedRoutes` (below) already excludes the two manage-tenants-only
// routes, so every capability reaching here is a `TenantCapability` —
// narrowed by a runtime check because `requiredCapabilityOf`'s return type
// cannot say so on its own.
function tenantCapabilityOf(route: AdminRoute): TenantCapability {
  const capability = requiredCapabilityOf(route);
  if (capability === MANAGE_TENANTS) {
    throw new Error(`capability-matrix: ${routeKey(route)} unexpectedly requires manage-tenants`);
  }
  return capability;
}

const TENANT_PATH_PREFIX = '/admin/tenants/:tenant/';

// The resource a route's own path names, read from its static segments
// alone — never from `capability`, so this is an oracle the table cannot
// agree with itself. `sessions` nested under a subject is the one
// resource that is not a sub-action of its parent (see its own
// ADMIN_ROUTES entry, "No view-sessions..."); every other nested static
// segment (`credentials`, `roles`, `composites`, `mappers`, `secret`,
// `promote`, `retire`, `test`, `clients`) is one.
function resourceFamilyOf(route: AdminRoute): string {
  if (!route.pattern.startsWith(TENANT_PATH_PREFIX)) {
    throw new Error(`capability-matrix: ${routeKey(route)} is not tenant-scoped`);
  }
  const segments = route.pattern
    .slice(TENANT_PATH_PREFIX.length)
    .split('/')
    .filter((segment) => segment.length > 0 && !segment.startsWith(':'));
  const [first, second] = segments;
  if (first === undefined) {
    throw new Error(`capability-matrix: ${routeKey(route)} names no resource segment`);
  }
  return second === 'sessions' ? second : first;
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

  // The grid above proves `authorizeAdmin` enforces whatever `ADMIN_ROUTES`
  // declares; it reads its own expectation from that same table, so a route
  // wired to a plausible but wrong capability — the copy-paste `CLAUDE.md`
  // names — passes it unchanged. These two checks read no capability from
  // the table at all: they hold for a correctly-wired route because of what
  // its path and method already say, independent of what any route
  // actually declares.
  describe('a route names a capability its own path and method already imply', () => {
    it('no mutating method requires a bare view-* capability', () => {
      for (const route of tenantScopedRoutes) {
        if (route.method === 'GET') continue;
        const capability = requiredCapabilityOf(route);
        expect(capability.startsWith('view-'), routeKey(route)).toBe(false);
      }
    });

    const families = new Map<string, AdminRoute[]>();
    for (const route of tenantScopedRoutes) {
      const family = resourceFamilyOf(route);
      families.set(family, [...(families.get(family) ?? []), route]);
    }
    const familyGroups = [...families.entries()].map(([family, routes]) => ({ family, routes }));

    it.each(familyGroups)(
      '$family: one capability, or a view/manage pair with GET on the view side',
      ({ family, routes }) => {
        const distinct = [...new Set(routes.map(tenantCapabilityOf))];
        if (distinct.length === 1) return;
        expect(distinct, `${family} names more than two capabilities`).toHaveLength(2);
        const [a, b] = distinct as [TenantCapability, TenantCapability];
        const view = viewCounterpart(a) === b ? b : viewCounterpart(b) === a ? a : undefined;
        expect(view, `${a} and ${b} share a resource but neither composes the other`).toBeDefined();
        for (const route of routes) {
          const usesView = tenantCapabilityOf(route) === view;
          expect(route.method === 'GET', routeKey(route)).toBe(usesView);
        }
      },
    );
  });
});
