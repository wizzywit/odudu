import { listBuiltinScopesResponseSchema, scopeImpactSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool } from '#/service/call-tool';
import { scopeCheckTools } from '#/service/tools/scope-checks';
import { describeReadTool } from '#/testing/conformance';
import { respondingWith } from '#/testing/fake-caller';

const ID = '0192a0a0-0000-7000-8000-000000000001';

function named(name: string) {
  const found = scopeCheckTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

function inputKeys(tool: { readonly input: z.ZodType }): string[] {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
  return Object.keys(schema.properties ?? {});
}

describe('scope check tools', () => {
  describeReadTool({
    tool: named('get_scope_impact'),
    response: scopeImpactSchema,
    pattern: '/admin/tenants/:tenant/scopes/:id/impact',
    input: { id: ID },
    params: { id: ID },
  });
  describeReadTool({
    tool: named('list_builtin_scopes'),
    response: listBuiltinScopesResponseSchema,
    pattern: '/admin/tenants/:tenant/scopes/builtins',
    text: ['items', 0, 'name'],
  });

  it('are reads under manage-tenant', () => {
    for (const tool of scopeCheckTools) {
      expect(tool.capability, tool.name).toBe('manage-tenant');
      expect(tool.access, tool.name).toBe('read');
    }
  });

  it('list_builtin_scopes answers an unpaged list: the built-in names are a fixed short set', async () => {
    const tool = named('list_builtin_scopes');
    expect(inputKeys(tool)).toEqual([]);
    const result = await callTool(
      tool,
      respondingWith({ items: [{ name: 'openid', present: true }] }),
      {},
    );
    expect(result.structuredContent).toEqual({
      data: { items: [{ name: 'openid', present: true }] },
    });
  });

  it('get_scope_impact refuses an id that is not a UUID before any call', async () => {
    const caller = respondingWith({});
    const result = await callTool(named('get_scope_impact'), caller, { id: '../x' });
    expect(result.isError).toBe(true);
    expect(caller.requests).toHaveLength(0);
  });
});
