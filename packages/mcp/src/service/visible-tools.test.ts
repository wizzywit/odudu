import { describe, expect, it } from 'vitest';
import { TOOLS } from '#/service/catalogue';
import { toolVisible, visibleTools } from '#/service/visible-tools';

const ALL = new Set([
  'manage-clients',
  'manage-tenant',
  'manage-tenants',
  'manage-sessions',
  'manage-keys',
  'view-users',
  'view-audit',
  'view-domains',
]);

const ALL_BUT_TENANTS = new Set([...ALL].filter((c) => c !== 'manage-tenants'));

describe('visibleTools', () => {
  it('lists every read tool and no write tool for a token holding mcp:read and an owner holding every capability', () => {
    expect(visibleTools(TOOLS, ['mcp:read'], ALL, true).map((t) => t.name)).toEqual(
      TOOLS.filter((t) => t.access === 'read').map((t) => t.name),
    );
  });

  it('lists the write tools to a token holding mcp:write, and only to one', () => {
    const names = (scope: string[]) => visibleTools(TOOLS, scope, ALL, true).map((t) => t.name);
    expect(names(['mcp:write'])).toContain('update_client_metadata');
    expect(names(['mcp:write'])).toContain('update_scope_metadata');
    expect(names(['mcp:read', 'mcp:write'])).toContain('update_client_metadata');
    expect(names(['mcp:read'])).not.toContain('update_client_metadata');
    expect(names(['mcp:read'])).not.toContain('update_scope_metadata');
    expect(names(['openid'])).toEqual([]);
  });

  it('lists a write tool only to an owner who holds its capability', () => {
    const names = (held: string[]) =>
      visibleTools(TOOLS, ['mcp:write'], new Set(held), true).map((t) => t.name);
    expect(names(['manage-tenant'])).toContain('update_scope_metadata');
    expect(names(['manage-tenant'])).not.toContain('update_client_metadata');
    expect(names(['manage-clients'])).toContain('update_client_metadata');
    expect(names(['manage-clients'])).not.toContain('update_scope_metadata');
  });

  it('lists a read tool for a token holding only mcp:write, as the admin API admits a GET under either', () => {
    expect(visibleTools(TOOLS, ['mcp:write'], ALL, true).map((t) => t.name)).toEqual(
      TOOLS.map((t) => t.name),
    );
  });

  it('lists nothing for a token holding neither scope', () => {
    expect(visibleTools(TOOLS, ['openid', 'profile'], ALL, true)).toEqual([]);
  });

  it('omits a tool whose capability the owner lacks, and keeps the one that needs none', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['view-users']), true).map(
      (t) => t.name,
    );
    expect(names).toContain('whoami');
    expect(names).toContain('list_subjects');
    expect(names).not.toContain('list_clients');
    expect(names).not.toContain('list_audit');
  });

  it('judges the scope alone when the owner is not judged', () => {
    expect(visibleTools(TOOLS, ['mcp:read'], null, true)).toHaveLength(
      TOOLS.filter((t) => t.access === 'read').length,
    );
    expect(visibleTools(TOOLS, ['mcp:write'], null, true)).toHaveLength(TOOLS.length);
    expect(visibleTools(TOOLS, ['openid'], null, true)).toEqual([]);
  });

  it('keeps the order of the catalogue', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['view-users']), true).map(
      (t) => t.name,
    );
    expect(names).toEqual([...names].sort());
  });

  it('lists a tool a route admits for a capability besides its own', () => {
    const tool = TOOLS.find((t) => t.name === 'list_roles');
    if (tool === undefined) throw new Error('no list_roles');
    expect(toolVisible(tool, ['mcp:read'], new Set(['view-users']), true)).toBe(true);
  });

  it('never lists a write tool to a token holding only mcp:read', () => {
    const write = { ...TOOLS[0], access: 'write' as const };
    expect(toolVisible(write as never, ['mcp:read'], ALL, true)).toBe(false);
    expect(toolVisible(write as never, ['mcp:write'], ALL, true)).toBe(true);
  });

  describe('the instance-level reads', () => {
    const names = (capabilities: ReadonlySet<string> | null, inSystemTenant: boolean) =>
      visibleTools(TOOLS, ['mcp:read'], capabilities, inSystemTenant).map((t) => t.name);

    it('lists list_tenants and count_tenants to a system-tenant token whose owner holds manage-tenants', () => {
      expect(names(new Set(['manage-tenants']), true)).toEqual([
        'count_tenants',
        'list_tenants',
        'whoami',
      ]);
    });

    it('omits them for an owner without manage-tenants, in the system tenant', () => {
      expect(names(ALL_BUT_TENANTS, true)).not.toContain('list_tenants');
      expect(names(ALL_BUT_TENANTS, true)).not.toContain('count_tenants');
    });

    it('omits them for a token outside the system tenant, whatever its owner holds', () => {
      expect(names(ALL, false)).not.toContain('list_tenants');
      expect(names(ALL, false)).not.toContain('count_tenants');
      expect(names(null, false)).not.toContain('list_tenants');
    });

    it('lists them when the owner is not judged, in the system tenant only', () => {
      expect(names(null, true)).toContain('list_tenants');
      expect(names(null, false)).not.toContain('count_tenants');
    });

    it('leaves every tool with a tenant route as it was outside the system tenant', () => {
      const inside = visibleTools(TOOLS, ['mcp:read'], ALL, true).map((t) => t.name);
      const outside = visibleTools(TOOLS, ['mcp:read'], ALL, false).map((t) => t.name);
      expect(inside.filter((n) => !outside.includes(n))).toEqual(['count_tenants', 'list_tenants']);
    });
  });

  it('hides the client theme tools from an owner without manage-clients, and keeps the tenant ones', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['manage-tenant']), false).map(
      (t) => t.name,
    );
    for (const tool of [
      'get_client_theme',
      'list_client_theme_versions',
      'get_client_theme_preview_info',
      'get_client_mail_branding',
    ]) {
      expect(names).not.toContain(tool);
    }
    for (const tool of ['get_theme', 'get_mail_branding', 'get_message_catalogue']) {
      expect(names).toContain(tool);
    }
  });

  it('offers the stylesheet hooks to an owner with manage-clients alone, as the route admits it', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['manage-clients']), false).map(
      (t) => t.name,
    );
    expect(names).toContain('get_stylesheet_hooks');
    expect(names).toContain('get_client_theme');
    expect(names).not.toContain('get_theme');
  });
});
