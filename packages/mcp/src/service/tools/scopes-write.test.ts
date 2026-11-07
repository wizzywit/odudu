import { clientScopeSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import { createScopeTool } from '#/service/tools/scopes-write';
import { describeCreateTool } from '#/testing/write-conformance';

describeCreateTool({
  tool: createScopeTool,
  response: clientScopeSchema,
  pattern: '/admin/tenants/:tenant/scopes',
  fields: {
    name: 'orders:read',
    description: 'Read the orders of the person',
    description_i18n: { de: 'Bestellungen lesen' },
    display_order: 4,
  },
  required: ['name'],
  text: ['description'],
  typed: ['name', 'description'],
  forbidden: {
    consent_text: 'agree to everything',
    consent_text_i18n: { en: 'agree' },
    include_in_id_token: true,
    include_in_access_token: true,
    default_client_assignment: 'default',
    role_ids: ['0192a0a0-0000-7000-8000-000000000009'],
  },
});

describe('create_scope', () => {
  it('is for a holder of manage-tenant, and says what a new scope is', () => {
    expect(createScopeTool.capability).toBe('manage-tenant');
    expect(createScopeTool.routeKey).toBe('POST /admin/tenants/:tenant/scopes');
    expect(createScopeTool.description).toMatch(/assigned to no client/u);
    expect(createScopeTool.description).toMatch(/consent text/u);
  });

  it.each(['read orders', 'a"b', 'a\\b', 'é', 'a\tb', ' x', 'x'.repeat(129)])(
    'refuses the name %j, which no client could ask for, before any call',
    async (name) => {
      const caller = respondingWith({}, 201);
      const result = await callTool(createScopeTool, caller, { idempotency_key: 'k', name });
      expect(result.isError).toBe(true);
      expect(caller.requests).toHaveLength(0);
    },
  );

  it.each(['orders', 'orders:read', 'https://api.example.com/orders.read', 'a-b_c.d'])(
    'takes the name %j',
    async (name) => {
      const caller = respondingWith({ id: '0192a0a0-0000-7000-8000-000000000001', name }, 201);
      await callTool(createScopeTool, caller, { idempotency_key: 'k', name });
      expect(caller.requests[0]?.body).toEqual({ name });
    },
  );

  it.each([-1, 1.5, 2_147_483_648, '4', null, Number.NaN])(
    'refuses the display order %j, which is an integer from 0',
    async (display_order) => {
      const caller = respondingWith({}, 201);
      const result = await callTool(createScopeTool, caller, {
        idempotency_key: 'k',
        name: 'orders',
        display_order,
      });
      expect(result.isError).toBe(true);
      expect(caller.requests).toHaveLength(0);
    },
  );
});
