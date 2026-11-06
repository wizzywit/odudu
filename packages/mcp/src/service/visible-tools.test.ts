import { describe, expect, it } from 'vitest';
import { TOOLS } from '#/service/catalogue';
import { toolVisible, visibleTools } from '#/service/visible-tools';

const ALL = new Set([
  'manage-clients',
  'manage-tenant',
  'manage-sessions',
  'manage-keys',
  'view-users',
  'view-audit',
  'view-domains',
]);

describe('visibleTools', () => {
  it('lists every read tool for a token holding mcp:read and an owner holding every capability', () => {
    expect(visibleTools(TOOLS, ['mcp:read'], ALL).map((t) => t.name)).toEqual(
      TOOLS.map((t) => t.name),
    );
  });

  it('lists a read tool for a token holding only mcp:write, as the admin API admits a GET under either', () => {
    expect(visibleTools(TOOLS, ['mcp:write'], ALL)).toHaveLength(TOOLS.length);
  });

  it('lists nothing for a token holding neither scope', () => {
    expect(visibleTools(TOOLS, ['openid', 'profile'], ALL)).toEqual([]);
  });

  it('omits a tool whose capability the owner lacks, and keeps the one that needs none', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['view-users'])).map((t) => t.name);
    expect(names).toContain('whoami');
    expect(names).toContain('list_subjects');
    expect(names).not.toContain('list_clients');
    expect(names).not.toContain('list_audit');
  });

  it('judges the scope alone when the owner is not judged', () => {
    expect(visibleTools(TOOLS, ['mcp:read'], null)).toHaveLength(TOOLS.length);
    expect(visibleTools(TOOLS, ['openid'], null)).toEqual([]);
  });

  it('keeps the order of the catalogue', () => {
    const names = visibleTools(TOOLS, ['mcp:read'], new Set(['view-users'])).map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it('lists a tool a route admits for a capability besides its own', () => {
    const tool = TOOLS.find((t) => t.name === 'list_roles');
    if (tool === undefined) throw new Error('no list_roles');
    expect(toolVisible(tool, ['mcp:read'], new Set(['view-users']))).toBe(true);
  });

  it('never lists a write tool to a token holding only mcp:read', () => {
    const write = { ...TOOLS[0], access: 'write' as const };
    expect(toolVisible(write as never, ['mcp:read'], ALL)).toBe(false);
    expect(toolVisible(write as never, ['mcp:write'], ALL)).toBe(true);
  });
});
