import { TOOLS, type RegisteredTool } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { assistantTools, assistantWriteTools, toolsFor } from '#/service/tool-set';

describe('assistantTools', () => {
  it('keeps the reads and drops the audit tools', () => {
    const names = assistantTools(TOOLS).map((tool) => tool.name);
    expect(names).toContain('list_clients');
    expect(names).not.toContain('list_audit');
    expect(names).not.toContain('count_audit');
    expect(TOOLS.filter((tool) => tool.access === 'read').length - names.length).toBe(2);
  });

  it('drops a read of the agents or the assistant’s own routes, however it is named', () => {
    const tool = (routeKey: string) => ({ name: 'x', access: 'read', routeKey }) as RegisteredTool;
    expect(
      assistantTools([
        tool('GET /admin/tenants/:tenant/agents'),
        tool('GET /admin/tenants/:tenant/agents/:id'),
        tool('GET /admin/tenants/:tenant/assistant/activity'),
        tool('GET /admin/tenants/:tenant/audit/count'),
        tool('GET /admin/tenants/:tenant/clients'),
      ]).map((entry) => entry.routeKey),
    ).toEqual(['GET /admin/tenants/:tenant/clients']);
  });
});

describe('assistantWriteTools', () => {
  it('are the twelve changes, and no read among them', () => {
    const tools = assistantWriteTools(TOOLS);
    expect(tools).toHaveLength(12);
    expect(tools.every((tool) => tool.access === 'write')).toBe(true);
    expect(assistantTools(TOOLS).some((tool) => tools.includes(tool))).toBe(false);
  });

  it('leave out a write that is not among the twelve', () => {
    const stray = {
      name: 'delete_client',
      access: 'write',
      routeKey: 'DELETE /x',
    } as RegisteredTool;
    expect(assistantWriteTools([stray])).toEqual([]);
  });
});

describe('toolsFor', () => {
  const home = { tenantId: 'h' };
  const away = { tenantId: 'h', target: { id: 'x', name: 'x' } };

  it('offers every tool in the administrator’s own tenant', () => {
    expect(toolsFor(TOOLS, home)).toBe(TOOLS);
  });

  it('leaves out the instance-wide reads in another tenant, which name no tenant in their path', () => {
    const offered = toolsFor(assistantTools(TOOLS), away).map((tool) => tool.name);
    expect(offered).not.toContain('list_tenants');
    expect(offered).not.toContain('count_tenants');
    expect(offered).toContain('list_clients');
    expect(toolsFor(TOOLS, away).every((tool) => tool.routeKey.includes('/:tenant'))).toBe(true);
  });
});

describe('the tools and the tenant', () => {
  it('no tool takes an argument that names a tenant, so the model never chooses one', () => {
    const named = TOOLS.flatMap((tool) => {
      const shape = (tool.input as { shape?: Record<string, unknown> }).shape;
      return Object.keys(shape ?? {})
        .filter((key) => /tenant/iu.test(key))
        .map((key) => `${tool.name}.${key}`);
    });
    expect(named).toEqual([]);
  });
});
