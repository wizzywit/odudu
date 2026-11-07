import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, TENANT_SETTING_NAMES } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import {
  AGENT_DENIED_READS,
  AGENT_WRITE_ROUTES,
  INSTANCE_READS,
  type AgentWriteRoute,
  agentBodyAdmitted,
  agentBodyNamesGuardedField,
  agentGuardsBuiltinScope,
  agentGuardsWholeClient,
  agentWritableFields,
  agentWriteNeedsEndpoint,
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

const STRUCTURE_ROUTES = [
  'PATCH /admin/tenants/:tenant/clients/:id',
  'PATCH /admin/tenants/:tenant/groups/:id',
  'PATCH /admin/tenants/:tenant/roles/:id',
  'PATCH /admin/tenants/:tenant/scopes/:id',
  'POST /admin/tenants/:tenant/groups',
  'POST /admin/tenants/:tenant/roles',
  'POST /admin/tenants/:tenant/scopes',
];

const SETTINGS = 'PATCH /admin/tenants/:tenant/settings';
const OVERRIDE = '/admin/tenants/:tenant/message-overrides/:locale/:key';
const WORDING_ROUTES = [SETTINGS, `PUT ${OVERRIDE}`, `DELETE ${OVERRIDE}`];
const THEME = '/admin/tenants/:tenant/theme';
const CLIENT_THEME = '/admin/tenants/:tenant/clients/:id/theme';
const THEME_ROUTES = [`PUT ${THEME}`, `PUT ${CLIENT_THEME}`];
const THEME_FIELDS = ['tokens', 'stylesheet', 'templates', 'assets'];
const ALLOWED_ROUTES = [...STRUCTURE_ROUTES, ...WORDING_ROUTES, ...THEME_ROUTES].sort();
const WORDING_FIELDS = ['display_name', 'supported_locales', 'default_locale'];

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

  it('lists only routes that exist, with the four methods a write may use', () => {
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(['PATCH', 'POST', 'PUT', 'DELETE']).toContain(entry.method);
      expect(route(entry.method, entry.pattern)).toBeDefined();
    }
    expect(AGENT_WRITE_ROUTES.map(key).sort()).toEqual(ALLOWED_ROUTES);
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
      'display_order',
    ]);
  });

  it('names the structure fields of a role, a group and a scope, and never a field that grants', () => {
    const fields = (method: string, pattern: string) =>
      agentWritableFields(route(method, `/admin/tenants/:tenant/${pattern}`));
    expect(fields('POST', 'roles')).toEqual(['name', 'description', 'client_id']);
    expect(fields('PATCH', 'roles/:id')).toEqual(['description']);
    expect(fields('POST', 'groups')).toEqual(['name', 'description']);
    expect(fields('PATCH', 'groups/:id')).toEqual(['description']);
    expect(fields('POST', 'scopes')).toEqual([
      'name',
      'description',
      'description_i18n',
      'display_order',
    ]);
    for (const entry of AGENT_WRITE_ROUTES) {
      for (const field of entry.fields) {
        expect(field, key(entry)).not.toMatch(
          /^(default_for_new_subjects|parent_id|include_in_|default_client_assignment|consent_text)/u,
        );
      }
    }
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

  it('keeps the shipped allowlist to its twelve entries, a theme body the only whole one', () => {
    expect(AGENT_WRITE_ROUTES.map(key).sort()).toEqual(ALLOWED_ROUTES);
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(entry.body, key(entry)).toBe(THEME_ROUTES.includes(key(entry)) ? 'whole' : 'fields');
    }
    expect(
      AGENT_WRITE_ROUTES.filter((entry) => entry.target !== 'none')
        .map(key)
        .sort(),
    ).toEqual([
      'PATCH /admin/tenants/:tenant/clients/:id',
      'PATCH /admin/tenants/:tenant/scopes/:id',
      `PUT ${CLIENT_THEME}`,
    ]);
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

describe('the W2 fields of each structure route', () => {
  const W2: Record<string, Record<string, unknown>[]> = {
    'POST /admin/tenants/:tenant/roles': [
      { name: 'r', default_for_new_subjects: true },
      { name: 'r', composites: ['x'] },
      { name: 'r', admin_reach: ['manage-tenant'] },
      { name: 'r', description: 'd', id: 'x' },
      { name: 'r', client_key: 'portal' },
      { name: 'r', parent_id: 'x' },
    ],
    'PATCH /admin/tenants/:tenant/roles/:id': [
      { name: 'renamed' },
      { default_for_new_subjects: true },
      { description: 'd', client_id: 'x' },
      { description: 'd', default: true },
      { composites: ['x'] },
      { description: 'd', parent_id: 'x' },
    ],
    'POST /admin/tenants/:tenant/groups': [
      { name: 'g', parent_id: 'x' },
      { name: 'g', default_for_new_subjects: true },
      { name: 'g', role_ids: ['x'] },
      { name: 'g', path: '/g' },
      { name: 'g', client_id: 'x' },
      { name: 'g', admin_reach: ['manage-tenant'] },
    ],
    'PATCH /admin/tenants/:tenant/groups/:id': [
      { parent_id: 'x' },
      { parent_id: null },
      { name: 'renamed' },
      { default_for_new_subjects: true },
      { description: 'd', path: '/x' },
      { role_ids: ['x'] },
    ],
    'POST /admin/tenants/:tenant/scopes': [
      { name: 's', consent_text: 'agree to all' },
      { name: 's', consent_text_i18n: { en: 'x' } },
      { name: 's', include_in_id_token: true },
      { name: 's', include_in_access_token: true },
      { name: 's', default_client_assignment: 'default' },
      { name: 's', role_ids: ['x'] },
    ],
    'PATCH /admin/tenants/:tenant/scopes/:id': [
      { consent_text: 'agree' },
      { consent_text_i18n: { en: 'x' } },
      { include_in_id_token: false },
      { include_in_access_token: false },
      { default_client_assignment: 'default' },
      { name: 'renamed' },
    ],
  };

  it('names every structure route', () => {
    expect(Object.keys(W2).sort()).toEqual(STRUCTURE_ROUTES.filter((k) => !k.includes('clients')));
  });

  it.each(Object.entries(W2).flatMap(([k, bodies]) => bodies.map((body) => [k, body] as const)))(
    '%s refuses %j',
    (k, body) => {
      const [method = '', pattern = ''] = k.split(' ');
      expect(agentBodyAdmitted(route(method, pattern), body)).toBe(false);
    },
  );

  it('refuses a W2 field beside a W1 one, and a body with a prototype member', () => {
    const create = route('POST', '/admin/tenants/:tenant/roles');
    const hostile: unknown = JSON.parse(
      '{"name":"r","__proto__":{"default_for_new_subjects":true}}',
    );
    expect(agentBodyAdmitted(create, hostile)).toBe(false);
    expect(agentBodyAdmitted(create, { name: 'r', description: 'd', client_id: 'c' })).toBe(true);
    expect(
      agentBodyAdmitted(route('PATCH', '/admin/tenants/:tenant/scopes/:id'), {
        description: 'd',
        display_order: 3,
      }),
    ).toBe(true);
  });
});

describe('agentWriteNeedsEndpoint', () => {
  it('is false for an amendment alone: a PATCH changes fields of what exists, and POST, PUT and DELETE add or remove a row', () => {
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(agentWriteNeedsEndpoint(route(entry.method, entry.pattern)), key(entry)).toBe(
        entry.method !== 'PATCH',
      );
    }
  });

  it('holds the override PUT and DELETE to the endpoint, and leaves the settings PATCH to a direct holder', () => {
    expect(agentWriteNeedsEndpoint(route('PUT', OVERRIDE))).toBe(true);
    expect(agentWriteNeedsEndpoint(route('DELETE', OVERRIDE))).toBe(true);
    expect(agentWriteNeedsEndpoint(route('PATCH', '/admin/tenants/:tenant/settings'))).toBe(false);
  });

  it('is false for a route outside the list, which the scope check refuses anyway', () => {
    expect(agentWriteNeedsEndpoint(route('GET', '/admin/tenants/:tenant/roles'))).toBe(false);
    expect(agentWriteNeedsEndpoint(route('POST', '/admin/tenants/:tenant/subjects'))).toBe(false);
  });

  it('follows a synthetic list, so a POST, PUT or DELETE added there is held the same way', () => {
    const entry = (method: AgentWriteRoute['method'], pattern: string): AgentWriteRoute => ({
      method,
      pattern,
      target: 'none',
      body: 'fields',
      fields: [],
    });
    const synthetic = [
      entry('POST', '/admin/tenants/:tenant/subjects'),
      entry('PUT', OVERRIDE),
      entry('DELETE', OVERRIDE),
      entry('PATCH', '/admin/tenants/:tenant/roles/:id'),
    ];
    const held = (method: string, pattern: string) =>
      agentWriteNeedsEndpoint(route(method, pattern), synthetic);
    expect(held('POST', '/admin/tenants/:tenant/subjects')).toBe(true);
    expect(held('PUT', OVERRIDE)).toBe(true);
    expect(held('DELETE', OVERRIDE)).toBe(true);
    expect(held('PATCH', '/admin/tenants/:tenant/roles/:id')).toBe(false);
  });
});

describe('the wording routes', () => {
  const settings = route('PATCH', '/admin/tenants/:tenant/settings');
  const put = route('PUT', OVERRIDE);
  const remove = route('DELETE', OVERRIDE);

  it('name the three W1 settings, the one message field and no body for a DELETE', () => {
    expect(agentWritableFields(settings)).toEqual(WORDING_FIELDS);
    expect(agentWritableFields(put)).toEqual(['message']);
    expect(agentWritableFields(remove)).toEqual([]);
  });

  it('admit the W1 settings alone and in any combination', () => {
    expect(agentBodyAdmitted(settings, { display_name: 'Acme' })).toBe(true);
    expect(agentBodyAdmitted(settings, { display_name: null, default_locale: 'de' })).toBe(true);
    expect(
      agentBodyAdmitted(settings, {
        display_name: 'Acme',
        supported_locales: ['en', 'de'],
        default_locale: 'en',
      }),
    ).toBe(true);
    expect(agentBodyAdmitted(put, { message: 'Hello' })).toBe(true);
    expect(agentBodyAdmitted(remove, undefined)).toBe(true);
  });

  const others = TENANT_SETTING_NAMES.filter((name) => !WORDING_FIELDS.includes(name));

  it('refuse each of the other settings, one by one, and every one beside a W1 name', () => {
    expect(others).toHaveLength(TENANT_SETTING_NAMES.length - WORDING_FIELDS.length);
    expect(others.length).toBeGreaterThan(30);
    for (const name of others) {
      expect(agentBodyAdmitted(settings, { [name]: 'x' }), name).toBe(false);
      expect(agentBodyAdmitted(settings, { display_name: 'Acme', [name]: 'x' }), `+${name}`).toBe(
        false,
      );
      expect(agentBodyAdmitted(settings, { [name]: false, default_locale: 'en' }), `${name}+`).toBe(
        false,
      );
    }
  });

  it('refuse a name that is not a setting, a casing of one, and a body that is not a record', () => {
    for (const body of [
      { Display_Name: 'x' },
      { 'display_name ': 'x' },
      { displayName: 'x' },
      { locale: 'de' },
      JSON.parse('{"display_name":"x","__proto__":{"otp_required":false}}') as unknown,
      [],
      null,
      'display_name',
      undefined,
    ]) {
      expect(agentBodyAdmitted(settings, body), JSON.stringify(body)).toBe(false);
    }
    expect(agentBodyAdmitted(put, { message: 'x', locale: 'de' })).toBe(false);
    expect(agentBodyAdmitted(remove, {})).toBe(false);
  });
});

describe('the theme draft routes', () => {
  const tenantPut = route('PUT', THEME);
  const clientPut = route('PUT', CLIENT_THEME);

  it('admit the four parts of a theme body, whole, and no other member', () => {
    for (const r of [tenantPut, clientPut]) {
      expect(agentWritableFields(r)).toEqual(THEME_FIELDS);
      expect(
        agentBodyAdmitted(r, { tokens: {}, stylesheet: null, templates: {}, assets: {} }),
      ).toBe(true);
      expect(agentBodyAdmitted(r, { tokens: {} })).toBe(true);
      expect(agentBodyAdmitted(r, { tokens: {}, enabled: false })).toBe(false);
      expect(agentBodyAdmitted(r, { name: 'x' })).toBe(false);
      expect(agentBodyAdmitted(r, [])).toBe(false);
      expect(agentBodyAdmitted(r, JSON.parse('{"tokens":{},"__proto__":{"a":1}}'))).toBe(false);
    }
  });

  it('are held to the endpoint, whose budget counts a draft that adds a row', () => {
    expect(agentWriteNeedsEndpoint(tenantPut)).toBe(true);
    expect(agentWriteNeedsEndpoint(clientPut)).toBe(true);
  });

  it('guard a built-in client whatever the body names, for the client route alone', () => {
    expect(agentWritesClient(clientPut)).toBe(true);
    expect(agentGuardsWholeClient(clientPut)).toBe(true);
    expect(agentWritesClient(tenantPut)).toBe(false);
    expect(agentGuardsWholeClient(tenantPut)).toBe(false);
    const patch = route('PATCH', '/admin/tenants/:tenant/clients/:id');
    expect(agentWritesClient(patch)).toBe(true);
    expect(agentGuardsWholeClient(patch)).toBe(false);
  });

  it('guard a built-in scope on the scope PATCH alone', () => {
    expect(agentGuardsBuiltinScope(route('PATCH', '/admin/tenants/:tenant/scopes/:id'))).toBe(true);
    expect(agentGuardsBuiltinScope(route('POST', '/admin/tenants/:tenant/scopes'))).toBe(false);
    expect(agentGuardsBuiltinScope(route('PATCH', '/admin/tenants/:tenant/roles/:id'))).toBe(false);
  });

  it('admit no route that publishes, restores, discards or resets a theme', () => {
    const base = ['/theme', '/clients/:id/theme'].map((s) => `/admin/tenants/:tenant${s}`);
    const refused = [
      ...base.map((b) => route('POST', `${b}/publish`)),
      ...base.map((b) => route('POST', `${b}/versions/:versionId/restore`)),
      ...base.map((b) => route('DELETE', `${b}/draft`)),
      ...base.map((b) => route('DELETE', b)),
    ];
    expect(refused).toHaveLength(8);
    for (const r of refused) {
      expect(scopeAdmits([MCP_WRITE_SCOPE], r, true), key(r)).toBe(false);
      expect(scopeAdmits([MCP_WRITE_SCOPE], r, false), key(r)).toBe(false);
      expect(agentBodyAdmitted(r, {}), key(r)).toBe(false);
    }
  });
});
