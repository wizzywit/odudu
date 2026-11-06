import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import {
  AGENT_DENIED_READS,
  AGENT_WRITE_ROUTES,
  INSTANCE_READS,
  type AgentWriteRoute,
  agentBodyAdmitted,
  agentBodyNamesGuardedField,
  agentWritableFields,
  agentWritesClient,
  doorToolName,
  isAdminRouteKey,
  scopeAdmits,
} from '#/service/agent-scope';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

const key = (route: Pick<AdminRoute, 'method' | 'pattern'>) => `${route.method} ${route.pattern}`;
const allowed = new Set(AGENT_WRITE_ROUTES.map(key));
const denied = new Set(AGENT_DENIED_READS);
const instance = new Set(INSTANCE_READS);

function route(method: string, pattern: string): AdminRoute {
  const found = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  if (found === undefined) throw new Error(`no route ${method} ${pattern}`);
  return found;
}

describe('scopeAdmits over every admin route', () => {
  it('covers a whole table, not a stub', () => {
    expect(ADMIN_ROUTES.length).toBeGreaterThan(100);
  });

  it.each(ADMIN_ROUTES.map((r) => [key(r), r] as const))('%s', (_, r) => {
    const read = r.method === 'GET' && !denied.has(key(r));
    const system = read || allowed.has(key(r));
    const local = read && !instance.has(key(r));
    expect(scopeAdmits([MCP_READ_SCOPE], r, true)).toBe(read);
    expect(scopeAdmits([MCP_WRITE_SCOPE], r, true)).toBe(system);
    expect(scopeAdmits([MCP_READ_SCOPE, MCP_WRITE_SCOPE], r, true)).toBe(system);
    expect(scopeAdmits([MCP_READ_SCOPE], r, false)).toBe(local);
    expect(scopeAdmits([MCP_WRITE_SCOPE], r, false)).toBe(local || allowed.has(key(r)));
    expect(scopeAdmits(['openid', 'profile'], r, true)).toBe(false);
    expect(scopeAdmits([], r, true)).toBe(false);
  });

  it('refuses the bulk and the sensitive reads to both scopes, and they exist', () => {
    expect([...denied].sort()).toEqual([
      'GET /admin/tenants/:tenant/audit/export',
      'GET /admin/tenants/:tenant/clients/:id/evaluate',
      'GET /admin/tenants/:tenant/export',
      'GET /admin/tenants/:tenant/registration-tokens',
      'GET /admin/tenants/:tenant/smtp',
      'GET /admin/tenants/:tenant/subjects/:id/credentials',
      'GET /admin/tenants/:tenant/subjects/:id/profile',
      'GET /admin/tenants/:tenant/theme/assets/:assetId/content',
    ]);
    for (const k of denied) {
      const r = ADMIN_ROUTES.find((x) => key(x) === k);
      expect(r).toBeDefined();
      if (r !== undefined) {
        expect(scopeAdmits([MCP_READ_SCOPE, MCP_WRITE_SCOPE], r, true)).toBe(false);
      }
    }
  });

  it('admits the tenant list and its count to an agent of the system tenant only', () => {
    expect([...instance].sort()).toEqual(['GET /admin/tenants', 'GET /admin/tenants/count']);
    for (const k of instance) {
      const r = ADMIN_ROUTES.find((x) => key(x) === k);
      expect(r, k).toBeDefined();
      if (r === undefined) continue;
      expect(scopeAdmits([MCP_READ_SCOPE], r, true), k).toBe(true);
      expect(scopeAdmits([MCP_WRITE_SCOPE], r, true), k).toBe(true);
      expect(scopeAdmits([MCP_READ_SCOPE, MCP_WRITE_SCOPE], r, false), k).toBe(false);
      expect(scopeAdmits(['openid'], r, true), k).toBe(false);
    }
  });

  it('leaves one tenant record, whichever tenant it is, as it was', () => {
    const one = route('GET', '/admin/tenants/:tenant');
    expect(scopeAdmits([MCP_READ_SCOPE], one, true)).toBe(true);
    expect(scopeAdmits([MCP_READ_SCOPE], one, false)).toBe(true);
  });

  it('lists only routes that exist, and only PATCHes', () => {
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(entry.method).toBe('PATCH');
      expect(route(entry.method, entry.pattern)).toBeDefined();
    }
    expect(AGENT_WRITE_ROUTES.map(key).sort()).toEqual([
      'PATCH /admin/tenants/:tenant/clients/:id',
      'PATCH /admin/tenants/:tenant/scopes/:id',
    ]);
  });
});

describe('agentWritableFields', () => {
  it('names descriptive fields only, for a client and a scope', () => {
    expect(agentWritableFields(route('PATCH', '/admin/tenants/:tenant/clients/:id'))).toEqual([
      'name',
      'description',
      'name_i18n',
      'description_i18n',
    ]);
    expect(agentWritableFields(route('PATCH', '/admin/tenants/:tenant/scopes/:id'))).toEqual([
      'description',
      'description_i18n',
    ]);
  });

  it('is empty for every route outside the allowlist', () => {
    for (const r of ADMIN_ROUTES.filter((x) => !allowed.has(key(x)))) {
      expect(agentWritableFields(r)).toEqual([]);
    }
  });
});

describe('agentBodyAdmitted', () => {
  const client = route('PATCH', '/admin/tenants/:tenant/clients/:id');
  const scope = route('PATCH', '/admin/tenants/:tenant/scopes/:id');

  it.each([
    [client, { name: 'x', description: null, name_i18n: { de: 'y' } }],
    [scope, { description: 'x', description_i18n: { de: 'y' } }],
  ])('admits a body of descriptive fields', (r, body) => {
    expect(agentBodyAdmitted(r, body)).toBe(true);
  });

  const proto: unknown = JSON.parse('{"name":"x","__proto__":{"enabled":true}}');
  const ctor: unknown = JSON.parse('{"constructor":{"x":1}}');
  const refused: [AdminRoute, unknown][] = [
    [client, { enabled: false }],
    [client, { redirect_uris: ['https://evil.example'] }],
    [client, { name: 'x', enabled: true }],
    [client, { Name: 'x' }],
    [client, { 'name ': 'x' }],
    [client, { client_name: 'x' }],
    [client, { name: 'x', client_uri: 'https://x' }],
    [client, { description_i18n: null, consent_required: false }],
    [client, proto],
    [client, ctor],
    [scope, { consent_text: 'agree' }],
    [scope, { include_in_access_token: false }],
    [scope, { default_client_assignment: 'default' }],
    [scope, { name: 'renamed' }],
    [client, []],
    [client, null],
    [client, 'name'],
    [client, undefined],
    [route('GET', '/admin/tenants/:tenant/clients'), { name: 'x' }],
    [route('PATCH', '/admin/tenants/:tenant/roles/:id'), { name: 'x' }],
  ];

  it.each(refused)('refuses a body with anything else in it', (r, body) => {
    expect(agentBodyAdmitted(r, body)).toBe(false);
  });

  it('admits a nested object under a descriptive field, which the usecase validates', () => {
    expect(agentBodyAdmitted(client, { description: { enabled: true } })).toBe(true);
  });

  it('reads a duplicate key as the parsed object holds it, the last one', () => {
    const body: unknown = JSON.parse('{"enabled":false,"enabled":false,"name":"x"}');
    expect(agentBodyAdmitted(client, body)).toBe(false);
    const second: unknown = JSON.parse('{"name":"a","name":"b"}');
    expect(agentBodyAdmitted(client, second)).toBe(true);
  });
});

describe('agentBodyNamesGuardedField', () => {
  it('is true for a name or its translations, false for the rest', () => {
    expect(agentBodyNamesGuardedField({ name: 'x' })).toBe(true);
    expect(agentBodyNamesGuardedField({ description: 'y', name_i18n: {} })).toBe(true);
    expect(agentBodyNamesGuardedField({ description: 'y', description_i18n: {} })).toBe(false);
  });
});

describe('isAdminRouteKey', () => {
  it('is true for every table entry, as METHOD pattern', () => {
    for (const r of ADMIN_ROUTES) expect(isAdminRouteKey(key(r))).toBe(true);
  });

  it.each([
    'GET /admin/tenants/:tenant/nothing',
    'GET /admin/tenants/acme/clients',
    'get /admin/tenants/:tenant/clients',
    'GET /admin/tenants/:tenant/clients?x=1',
    '/admin/tenants/:tenant/clients',
    '',
  ])('is false for %j', (candidate) => {
    expect(isAdminRouteKey(candidate)).toBe(false);
  });

  it('fits the audit allowlist for every entry', () => {
    const longest = Math.max(...ADMIN_ROUTES.map((r) => key(r).length));
    expect(longest).toBeLessThanOrEqual(170);
  });
});

describe('doorToolName', () => {
  it('names every admin route in the audit vocabulary’s tool charset and length', () => {
    for (const route of ADMIN_ROUTES) {
      const name = doorToolName(`${route.method} ${route.pattern}`);
      expect(name, route.pattern).toMatch(/^[a-z0-9_.-]{1,64}$/u);
      expect(name.startsWith('admin.')).toBe(true);
    }
  });

  it('reads like the route', () => {
    expect(doorToolName('GET /admin/tenants/:tenant/clients/:id')).toBe('admin.get.clients.id');
    expect(doorToolName('GET /admin/tenants/:tenant/whoami')).toBe('admin.get.whoami');
    expect(doorToolName('GET /admin/tenants')).toBe('admin.get.tenants');
  });
});

describe('an allowlist of every method and body mode', () => {
  const rolesPost: AgentWriteRoute = {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/roles',
    target: 'none',
    body: 'fields',
    fields: ['name', 'description', 'client_id'],
  };
  const overridePut: AgentWriteRoute = {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    target: 'none',
    body: 'whole',
    fields: ['message'],
  };
  const overrideDelete: AgentWriteRoute = {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    target: 'none',
    body: 'fields',
    fields: [],
  };
  const clientPatch = AGENT_WRITE_ROUTES[0];
  const synthetic: readonly AgentWriteRoute[] = [
    rolesPost,
    overridePut,
    overrideDelete,
    ...(clientPatch === undefined ? [] : [clientPatch]),
  ];
  const listed = new Set(synthetic.map(key));

  it.each(ADMIN_ROUTES.map((r) => [key(r), r] as const))('admits %s as listed', (_, r) => {
    const read = r.method === 'GET' && !denied.has(key(r));
    const written = listed.has(key(r));
    expect(scopeAdmits([MCP_READ_SCOPE], r, true, synthetic)).toBe(read);
    expect(scopeAdmits([MCP_WRITE_SCOPE], r, true, synthetic)).toBe(read || written);
    expect(scopeAdmits([MCP_READ_SCOPE, MCP_WRITE_SCOPE], r, true, synthetic)).toBe(
      read || written,
    );
    expect(scopeAdmits(['openid'], r, true, synthetic)).toBe(false);
  });

  it('matches the method as well as the route', () => {
    const put = route('PUT', rolesPost.pattern.replace('roles', 'message-overrides/:locale/:key'));
    const patch = route('PATCH', '/admin/tenants/:tenant/roles/:id');
    expect(scopeAdmits([MCP_WRITE_SCOPE], put, true, synthetic)).toBe(true);
    expect(scopeAdmits([MCP_WRITE_SCOPE], patch, true, synthetic)).toBe(false);
    const post = route('POST', '/admin/tenants/:tenant/groups');
    expect(scopeAdmits([MCP_WRITE_SCOPE], post, true, synthetic)).toBe(false);
  });

  it('keeps the shipped allowlist to its two PATCH entries', () => {
    expect(AGENT_WRITE_ROUTES.map(key).sort()).toEqual([
      'PATCH /admin/tenants/:tenant/clients/:id',
      'PATCH /admin/tenants/:tenant/scopes/:id',
    ]);
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(entry.body).toBe('fields');
      expect(entry.target).not.toBe('none');
    }
  });

  const create = route('POST', '/admin/tenants/:tenant/roles');
  const put = route('PUT', '/admin/tenants/:tenant/message-overrides/:locale/:key');
  const remove = route('DELETE', '/admin/tenants/:tenant/message-overrides/:locale/:key');
  const proto: unknown = JSON.parse('{"name":"x","__proto__":{"default_for_new_subjects":true}}');
  const protoWhole: unknown = JSON.parse('{"message":"x","__proto__":{"a":1}}');

  it.each([
    [create, { name: 'n', description: null, client_id: 'c' }],
    [create, {}],
    [put, { message: 'text' }],
    [put, {}],
  ])('admits only the named members of a body', (r, body) => {
    expect(agentBodyAdmitted(r, body, synthetic)).toBe(true);
  });

  it.each([
    [create, { name: 'n', default_for_new_subjects: true }],
    [create, { Name: 'n' }],
    [create, proto],
    [create, []],
    [create, null],
    [create, 'name'],
    [create, undefined],
    [put, { message: 'x', locale: 'de' }],
    [put, protoWhole],
    [put, ['message']],
    [put, null],
    [put, 'message'],
    [put, 7],
    [put, undefined],
  ])('refuses a body outside the named members or not a record', (r, body) => {
    expect(agentBodyAdmitted(r, body, synthetic)).toBe(false);
  });

  it('reads a duplicate key as the parsed object holds it, in both modes', () => {
    const ok: unknown = JSON.parse('{"message":"a","message":"b"}');
    expect(agentBodyAdmitted(put, ok, synthetic)).toBe(true);
    const bad: unknown = JSON.parse('{"message":"a","locale":"x","locale":"y"}');
    expect(agentBodyAdmitted(put, bad, synthetic)).toBe(false);
  });

  it('admits no body for a DELETE and none for a route outside the list', () => {
    expect(agentBodyAdmitted(remove, undefined, synthetic)).toBe(true);
    expect(agentBodyAdmitted(remove, {}, synthetic)).toBe(false);
    expect(agentBodyAdmitted(remove, null, synthetic)).toBe(false);
    expect(agentBodyAdmitted(remove, { message: 'x' }, synthetic)).toBe(false);
    const get = route('GET', '/admin/tenants/:tenant/roles');
    expect(agentBodyAdmitted(get, undefined, synthetic)).toBe(false);
    expect(agentBodyAdmitted(route('POST', '/admin/tenants/:tenant/groups'), {}, synthetic)).toBe(
      false,
    );
  });

  it('reads the fields and the target of the entry the route names', () => {
    expect(agentWritableFields(create, synthetic)).toEqual(['name', 'description', 'client_id']);
    expect(agentWritableFields(remove, synthetic)).toEqual([]);
    expect(agentWritesClient(create, synthetic)).toBe(false);
    expect(agentWritesClient(route('PATCH', '/admin/tenants/:tenant/clients/:id'), synthetic)).toBe(
      true,
    );
  });
});
