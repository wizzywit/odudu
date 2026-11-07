import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '@odudu/protocol-admin';
import { NOT_TOOLS, TOOLS } from '#/service/catalogue';

// Lists that answer a small fixed set whole: the built-in scopes, and at most
// twenty theme versions.
const UNPAGED_LISTS = ['list_builtin_scopes', 'list_theme_versions', 'list_client_theme_versions'];

describe('the catalogue', () => {
  it('lists every tool input as a JSON schema that takes no key it does not name', () => {
    for (const tool of TOOLS) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(schema.type, tool.name).toBe('object');
      expect(schema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('bounds the page size of every list in the schema a client sees', () => {
    const paged = TOOLS.filter(
      (tool) => tool.name.startsWith('list_') && !UNPAGED_LISTS.includes(tool.name),
    );
    expect(paged.length).toBeGreaterThan(10);
    for (const tool of paged) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(schema.properties?.limit, tool.name).toMatchObject({ maximum: 200, minimum: 1 });
    }
  });

  it('has exactly seven tools that write, each a PATCH of descriptive fields or a POST that creates', () => {
    const writes = TOOLS.filter((tool) => tool.access === 'write');
    expect(writes.map((tool) => tool.name)).toEqual([
      'create_group',
      'create_role',
      'create_scope',
      'update_client_metadata',
      'update_group_description',
      'update_role_description',
      'update_scope_metadata',
    ]);
    for (const tool of writes) {
      const creates = tool.routeKey.startsWith('POST ');
      expect(creates || tool.routeKey.startsWith('PATCH '), tool.name).toBe(true);
      expect(tool.spends, tool.name).toBe(creates ? 'create' : 'mutating');
      expect(tool.name.startsWith(creates ? 'create_' : 'update_'), tool.name).toBe(true);
    }
    expect(
      TOOLS.filter((tool) => tool.access === 'read').every((tool) =>
        tool.routeKey.startsWith('GET '),
      ),
    ).toBe(true);
  });

  it('gives every tool that writes a budget to spend, and no read one', () => {
    for (const tool of TOOLS) {
      expect(tool.spends !== undefined, tool.name).toBe(tool.access === 'write');
    }
  });

  it('takes the tenant from no tool input', () => {
    for (const tool of TOOLS) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(Object.keys(schema.properties ?? {}), tool.name).not.toContain('tenant');
    }
  });

  it('keeps the tools and the withheld routes apart', () => {
    for (const tool of TOOLS) expect(NOT_TOOLS, tool.name).not.toHaveProperty([tool.routeKey]);
  });

  it('offers the six small reads as tools, and keeps the client evaluation withheld', () => {
    const T = '/admin/tenants/:tenant';
    const routes = [
      `GET ${T}`,
      `GET ${T}/subjects/username-policy`,
      `GET ${T}/domains/passkey-impact`,
      `GET ${T}/scopes/:id/impact`,
      `GET ${T}/scopes/builtins`,
      `GET ${T}/clients/:id/installation`,
    ];
    const served = TOOLS.map((tool) => tool.routeKey);
    for (const route of routes) {
      expect(served, route).toContain(route);
      expect(NOT_TOOLS, route).not.toHaveProperty([route]);
    }
    expect(served).not.toContain(`GET ${T}/clients/:id/evaluate`);
    expect(NOT_TOOLS).toHaveProperty([`GET ${T}/clients/:id/evaluate`]);
  });

  it('offers the eleven branding reads as tools, and keeps the asset bytes and the previews withheld', () => {
    const T = '/admin/tenants/:tenant';
    const routes = [
      `GET ${T}/theme`,
      `GET ${T}/theme/versions`,
      `GET ${T}/theme/preview/info`,
      `GET ${T}/theme/stylesheet-hooks`,
      `GET ${T}/mail/branding`,
      `GET ${T}/message-overrides`,
      `GET ${T}/message-catalogue`,
      `GET ${T}/clients/:id/theme`,
      `GET ${T}/clients/:id/theme/versions`,
      `GET ${T}/clients/:id/theme/preview/info`,
      `GET ${T}/clients/:id/mail/branding`,
    ];
    const served = TOOLS.map((tool) => tool.routeKey);
    for (const route of routes) {
      expect(served, route).toContain(route);
      expect(NOT_TOOLS, route).not.toHaveProperty([route]);
    }
    for (const route of [
      `GET ${T}/theme/assets/:assetId/content`,
      `GET ${T}/theme/preview`,
      `GET ${T}/mail/preview`,
      `GET ${T}/clients/:id/theme/preview`,
      `GET ${T}/clients/:id/mail/preview`,
    ]) {
      expect(served, route).not.toContain(route);
      expect(NOT_TOOLS, route).toHaveProperty([route]);
    }
  });

  it('gives long text only to the two theme documents, by name', () => {
    const long = TOOLS.filter((tool) => tool.description.includes('131,072'));
    expect(long.map((tool) => tool.name)).toEqual(['get_client_theme', 'get_theme']);
  });

  it("answers with the schema the route's own contract declares", () => {
    for (const tool of TOOLS) {
      const route = ADMIN_ROUTES.find(
        (candidate) => `${candidate.method} ${candidate.pattern}` === tool.routeKey,
      );
      expect(tool.response, tool.name).toBe(route?.responseSchema);
    }
  });
});
