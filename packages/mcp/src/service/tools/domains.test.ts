import {
  domainSchema,
  listDomainsResponseSchema,
  passkeyImpactQuerySchema,
  passkeyImpactResponseSchema,
} from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import { describeReadTool } from '#/testing/conformance';
import { domainTools } from '#/service/tools/domains';

function named(name: string) {
  const found = domainTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

function inputKeys(tool: { readonly input: z.ZodType }): string[] {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
  return Object.keys(schema.properties ?? {});
}

describe('domains tools', () => {
  describeReadTool({
    tool: named('list_domains'),
    response: listDomainsResponseSchema,
    pattern: '/admin/tenants/:tenant/domains',
    paged: true,
    text: ['items', 0, 'host'],
  });
  describeReadTool({
    tool: named('get_domain'),
    response: domainSchema,
    pattern: '/admin/tenants/:tenant/domains/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['host'],
  });
  describeReadTool({
    tool: named('get_passkey_impact'),
    response: passkeyImpactResponseSchema,
    pattern: '/admin/tenants/:tenant/domains/passkey-impact',
    input: { canonical: 'login.example.com' },
    query: { canonical: 'login.example.com' },
  });

  describe('get_passkey_impact', () => {
    it('is view-domains and takes the contract query shape', () => {
      const tool = named('get_passkey_impact');
      expect(tool.capability).toBe('view-domains');
      expect(inputKeys(tool)).toEqual(Object.keys(passkeyImpactQuerySchema.shape));
    });

    it('refuses an empty or oversized canonical before any call', async () => {
      for (const canonical of ['', 'x'.repeat(513), 5]) {
        const caller = respondingWith({ subjects: 0, capped: false });
        const result = await callTool(named('get_passkey_impact'), caller, { canonical });
        expect(result.isError, String(canonical)).toBe(true);
        expect(caller.requests).toHaveLength(0);
      }
    });

    it('refuses a call with no canonical', async () => {
      const caller = respondingWith({ subjects: 0, capped: false });
      const result = await callTool(named('get_passkey_impact'), caller, {});
      expect(result.isError).toBe(true);
      expect(caller.requests).toHaveLength(0);
    });
  });
});
