import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import {
  AGENT_WRITE_ROUTES,
  agentBodyAdmitted,
  agentWritableFields,
  scopeAdmits,
} from '#/service/agent-scope';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

const key = (route: Pick<AdminRoute, 'method' | 'pattern'>) => `${route.method} ${route.pattern}`;
const allowed = new Set(AGENT_WRITE_ROUTES.map(key));

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
    expect(scopeAdmits([MCP_READ_SCOPE], r)).toBe(r.method === 'GET');
    expect(scopeAdmits([MCP_WRITE_SCOPE], r)).toBe(r.method === 'GET' || allowed.has(key(r)));
    expect(scopeAdmits([MCP_READ_SCOPE, MCP_WRITE_SCOPE], r)).toBe(
      r.method === 'GET' || allowed.has(key(r)),
    );
    expect(scopeAdmits(['openid', 'profile'], r)).toBe(false);
    expect(scopeAdmits([], r)).toBe(false);
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
      'client_name',
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
    [client, { client_name: 'x' }],
    [scope, { description: 'x', description_i18n: { de: 'y' } }],
  ])('admits a body of descriptive fields', (r, body) => {
    expect(agentBodyAdmitted(r, body)).toBe(true);
  });

  it.each([
    [client, { enabled: false }],
    [client, { redirect_uris: ['https://evil.example'] }],
    [client, { name: 'x', enabled: true }],
    [client, { description: { enabled: true } }, true],
    [client, { Name: 'x' }],
    [client, { 'name ': 'x' }],
    [client, { client_name: 'x', client_uri: 'https://x' }],
    [client, { description_i18n: null, consent_required: false }],
    [client, JSON.parse('{"name":"x","__proto__":{"enabled":true}}')],
    [client, JSON.parse('{"constructor":{"x":1}}')],
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
  ])('refuses a body with anything else in it', (r, body, ok) => {
    expect(agentBodyAdmitted(r, body)).toBe(ok === true);
  });

  it('reads a duplicate key as the parsed object holds it, the last one', () => {
    const body: unknown = JSON.parse('{"enabled":false,"enabled":false,"name":"x"}');
    expect(agentBodyAdmitted(client, body)).toBe(false);
    const second: unknown = JSON.parse('{"name":"a","name":"b"}');
    expect(agentBodyAdmitted(client, second)).toBe(true);
  });
});
