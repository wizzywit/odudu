import { TOOLS, type RegisteredTool } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { assistantTools } from '#/service/tool-set';

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
