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

describe('the published OpenAPI document', () => {
  it('describes every route the router registers', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{ paths: Record<string, Record<string, unknown>> }>();
    for (const route of ADMIN_ROUTES) {
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      expect(
        doc.paths[path]?.[route.method.toLowerCase()],
        `${route.method} ${path}`,
      ).toBeDefined();
    }
  });

  it('describes no route the router does not register', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{ paths: Record<string, Record<string, unknown>> }>();
    // Checked against Fastify's own route table, not ADMIN_ROUTES: the
    // document is built from that array, so comparing it to itself could
    // never catch a documented route the router no longer serves.
    for (const [path, methods] of Object.entries(doc.paths)) {
      const fastifyUrl = path.replace(/\{(\w+)\}/gu, ':$1');
      for (const method of Object.keys(methods)) {
        expect(
          fixture.http.hasRoute({ method: method.toUpperCase(), url: fastifyUrl }),
          `${method} ${path}`,
        ).toBe(true);
      }
    }
  });

  it('is served without authentication, and describes the scheme it requires', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string }>();
    expect(doc.openapi).toMatch(/^3\.1\./u);
  });

  it('declares the bearer scheme and the fixed admin-API audience', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{
      components: { securitySchemes: Record<string, { type: string; scheme: string }> };
    }>();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('carries the front-channel caveat on ending a session, for a client that never reads our docs', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{
      paths: Record<string, Record<string, { description?: string }>>;
    }>();
    const operation = doc.paths['/admin/tenants/{tenant}/subjects/{id}/sessions/{sid}']?.delete;
    expect(operation?.description).toContain('No Front-Channel Logout');
  });

  it('describes the tenant path parameter once, as a shared component', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{
      paths: Record<string, Record<string, { parameters?: unknown[] }>>;
      components: { parameters: Record<string, { name: string; in: string }> };
    }>();
    expect(doc.components.parameters.tenant).toMatchObject({ name: 'tenant', in: 'path' });
    for (const [path, methods] of Object.entries(doc.paths)) {
      // `/admin/tenants` administers the collection itself and carries no
      // `{tenant}` segment, so it declares no tenant parameter either —
      // only paths that actually template `{tenant}` reference it.
      const expected = path.includes('{tenant}')
        ? [{ $ref: '#/components/parameters/tenant' }]
        : [];
      for (const operation of Object.values(methods)) {
        expect(operation.parameters).toEqual(expected);
      }
    }
  });
});
