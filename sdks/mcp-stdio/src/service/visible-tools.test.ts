import { describe, expect, it } from 'vitest';
import { parseCatalogue } from '#/service/catalogue';
import { toolOf } from '#/service/catalogue-tool';
import generated from '../mcp-tools.json' with { type: 'json' };
import { directCallerTools, toolVisible, visibleTools } from '#/service/visible-tools';

const tools = parseCatalogue(generated).tools.map(toolOf);
const read = { access: 'read', routeKey: 'GET /admin/tenants/:tenant/clients' } as const;
const write = { access: 'write', routeKey: 'PATCH /admin/tenants/:tenant/clients/:id' } as const;
const instance = { access: 'read', routeKey: 'GET /admin/tenants' } as const;

describe('which tools a sign-in is offered', () => {
  it('offers a read under either scope and a write under mcp:write alone', () => {
    expect(toolVisible(read, ['mcp:read'], false)).toBe(true);
    expect(toolVisible(read, ['mcp:write'], false)).toBe(true);
    expect(toolVisible(write, ['mcp:read'], false)).toBe(false);
    expect(toolVisible(write, ['mcp:write'], false)).toBe(true);
    expect(toolVisible(read, [], false)).toBe(false);
  });

  it('offers a tool that spans tenants in the system tenant only', () => {
    expect(toolVisible(instance, ['mcp:read'], false)).toBe(false);
    expect(toolVisible(instance, ['mcp:read'], true)).toBe(true);
  });

  it('lists nothing but reads for a read-only sign-in, across the whole catalogue', () => {
    const offered = visibleTools(tools, ['mcp:read'], true);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((tool) => tool.access === 'read')).toBe(true);
    const outsideSystem = visibleTools(tools, ['mcp:read'], false);
    expect(outsideSystem.every((tool) => tool.routeKey.includes(':tenant'))).toBe(true);
    expect(outsideSystem.length).toBeLessThan(offered.length);
  });

  it('offers the writes too under mcp:write', () => {
    const names = visibleTools(tools, ['mcp:write'], true).map((tool) => tool.name);
    expect(names).toContain('update_client_metadata');
    expect(names).toContain('whoami');
  });

  it('serves a direct caller reads and amendments only', () => {
    const served = directCallerTools([
      read,
      write,
      { access: 'write', routeKey: 'POST /admin/tenants/:tenant/roles' },
      { access: 'write', routeKey: 'DELETE /admin/tenants/:tenant/roles/:id' },
      { access: 'write', routeKey: 'PUT /admin/tenants/:tenant/theme' },
    ] as never[]);
    expect(served.map((tool) => (tool as { routeKey: string }).routeKey)).toEqual([
      read.routeKey,
      write.routeKey,
    ]);
    expect(directCallerTools(tools)).toHaveLength(tools.length);
  });
});
