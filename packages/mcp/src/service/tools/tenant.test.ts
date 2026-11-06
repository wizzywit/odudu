import { tenantSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool } from '#/service/call-tool';
import { ownTenantTool } from '#/service/tools/tenant';
import { describeReadTool } from '#/testing/conformance';
import { respondingWith } from '#/testing/fake-caller';

function inputKeys(tool: { readonly input: z.ZodType }): string[] {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
  return Object.keys(schema.properties ?? {});
}

describe('tenant tool', () => {
  describeReadTool({
    tool: ownTenantTool,
    response: tenantSchema,
    pattern: '/admin/tenants/:tenant',
    text: ['display_name'],
  });

  it("is get_tenant: manage-tenant, a GET of the caller's own tenant, taking no argument", () => {
    expect(ownTenantTool.name).toBe('get_tenant');
    expect(ownTenantTool.capability).toBe('manage-tenant');
    expect(ownTenantTool.access).toBe('read');
    expect(ownTenantTool.routeKey).toBe('GET /admin/tenants/:tenant');
    expect(inputKeys(ownTenantTool)).toEqual([]);
  });

  it('refuses a tenant argument under any spelling, before any call', async () => {
    for (const extra of [{ tenant: 'other' }, { tenant_id: 'x' }, { name: 'other' }, { id: 'x' }]) {
      const caller = respondingWith({});
      const result = await callTool(ownTenantTool, caller, extra);
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(caller.requests).toHaveLength(0);
    }
  });

  it('asks for the route with no path parameter, so the door fills in the signed-in tenant', async () => {
    const caller = respondingWith({
      id: '0192a0a0-0000-7000-8000-000000000001',
      name: 'acme',
      display_name: null,
      enabled: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await callTool(ownTenantTool, caller, {});
    expect(caller.requests[0]?.params).toEqual({});
    expect(caller.requests[0]?.query).toEqual({});
  });
});
