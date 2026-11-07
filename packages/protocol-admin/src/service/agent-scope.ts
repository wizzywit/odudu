import { holdsMcpScope, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

// One mutation an agent token may make: the method and route, what its target
// is (a built-in client is guarded), and what its body may hold. `fields` is
// a body of named members of the resource; `whole` is a body that is the
// resource, as a theme draft is. Either admits the named members and nothing
// else, and a DELETE admits no body at all.
export interface AgentWriteRoute {
  readonly method: 'PATCH' | 'POST' | 'PUT' | 'DELETE';
  readonly pattern: string;
  readonly target: 'client' | 'scope' | 'none';
  readonly body: 'fields' | 'whole';
  readonly fields: readonly string[];
}

// Reads an agent never gets, though a GET. The first three each return a whole
// tenant, or bytes, in one call; a person fetches those with their own token.
// The rest are personal data, credential metadata and the mail relay login,
// which the MCP tool catalogue withholds (`NOT_TOOLS`, kinds `denied` and
// `sensitive`): a tool's absence binds nobody who holds the bearer, so the
// door refuses them too, and the coverage test holds the two lists to each
// other.
export const AGENT_DENIED_READS: readonly string[] = [
  'GET /admin/tenants/:tenant/export',
  'GET /admin/tenants/:tenant/audit/export',
  'GET /admin/tenants/:tenant/theme/assets/:assetId/content',
  'GET /admin/tenants/:tenant/subjects/:id/profile',
  'GET /admin/tenants/:tenant/subjects/:id/credentials',
  'GET /admin/tenants/:tenant/registration-tokens',
  'GET /admin/tenants/:tenant/smtp',
  'GET /admin/tenants/:tenant/clients/:id/evaluate',
];

// The two reads that span tenants. An agent acts inside the one tenant its
// token names, except that an agent of the system tenant, whose owner holds
// `manage-tenants`, may list and count them: the door admits these to a token
// of the system tenant alone, and `authorizeAdmin` then asks the owner for the
// capability.
export const INSTANCE_READS: readonly string[] = ['GET /admin/tenants', 'GET /admin/tenants/count'];

// A built-in client's name is what an administrator or MCP user recognises
// on the consent screen, so an agent never rewrites it.
const BUILTIN_CLIENT_GUARDED_FIELDS: readonly string[] = ['name', 'name_i18n'];

// What `mcp:write` adds to the reads: amending the wording a person reads,
// creating a role, group or scope that grants nothing, and setting or clearing
// a message override, never what a client, role, group or scope may do.
// Admission is by field because the same PATCH carries `enabled`,
// `redirect_uris` and the rest for an ordinary caller, and the settings PATCH
// carries every setting there is. `consent_text` is left out on purpose: it is
// what a user agrees to. `default_for_new_subjects`, `parent_id` and a scope's
// token and assignment settings are left out because each decides who holds what.
export const AGENT_WRITE_ROUTES: readonly AgentWriteRoute[] = [
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    target: 'client',
    body: 'fields',
    fields: ['name', 'description', 'name_i18n', 'description_i18n'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    target: 'scope',
    body: 'fields',
    fields: ['description', 'description_i18n', 'display_order'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/roles/:id',
    target: 'none',
    body: 'fields',
    fields: ['description'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/groups/:id',
    target: 'none',
    body: 'fields',
    fields: ['description'],
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/roles',
    target: 'none',
    body: 'fields',
    fields: ['name', 'description', 'client_id'],
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/groups',
    target: 'none',
    body: 'fields',
    fields: ['name', 'description'],
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/scopes',
    target: 'none',
    body: 'fields',
    fields: ['name', 'description', 'description_i18n', 'display_order'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/settings',
    target: 'none',
    body: 'fields',
    fields: ['display_name', 'supported_locales', 'default_locale'],
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    target: 'none',
    body: 'fields',
    fields: ['message'],
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    target: 'none',
    body: 'fields',
    fields: [],
  },
];

function writeEntry(
  route: Pick<AdminRoute, 'method' | 'pattern'>,
  routes: readonly AgentWriteRoute[],
): AgentWriteRoute | undefined {
  return routes.find((entry) => entry.method === route.method && entry.pattern === route.pattern);
}

export function scopeAdmits(
  scopes: readonly string[],
  route: AdminRoute,
  tenantIsSystem: boolean,
  routes: readonly AgentWriteRoute[] = AGENT_WRITE_ROUTES,
): boolean {
  if (route.method === 'GET') {
    const key = `${route.method} ${route.pattern}`;
    if (AGENT_DENIED_READS.includes(key)) return false;
    if (INSTANCE_READS.includes(key) && !tenantIsSystem) return false;
    return holdsMcpScope(scopes);
  }
  return scopes.includes(MCP_WRITE_SCOPE) && writeEntry(route, routes) !== undefined;
}

export function agentWritableFields(
  route: AdminRoute,
  routes: readonly AgentWriteRoute[] = AGENT_WRITE_ROUTES,
): readonly string[] {
  return writeEntry(route, routes)?.fields ?? [];
}

// Reads the body the handler will read, as parsed: a duplicate key is already
// its last value and `__proto__` an own key no allowlist names. A route
// outside the list admits nothing, and a DELETE admits no body.
export function agentBodyAdmitted(
  route: AdminRoute,
  body: unknown,
  routes: readonly AgentWriteRoute[] = AGENT_WRITE_ROUTES,
): boolean {
  const entry = writeEntry(route, routes);
  if (entry === undefined) return false;
  if (entry.method === 'DELETE') return body === undefined;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  return Reflect.ownKeys(body).every(
    (member) => typeof member === 'string' && entry.fields.includes(member),
  );
}

// A write that is not an amendment adds or removes a row: a POST creates one,
// a PUT can create one, a DELETE removes one. The budget that bounds those is
// spent by the MCP endpoint, which counts what it forwards. A token the
// endpoint did not sign (one issued to an agent that calls the admin API
// itself, as `odudu mcp` does) would add or remove without a count, so the door
// admits every entry but a PATCH to an endpoint token alone, derived from the
// method so that a later entry is held with no flag.
export function agentWriteNeedsEndpoint(
  route: AdminRoute,
  routes: readonly AgentWriteRoute[] = AGENT_WRITE_ROUTES,
): boolean {
  const entry = writeEntry(route, routes);
  return entry !== undefined && entry.method !== 'PATCH';
}

export function agentWritesClient(
  route: AdminRoute,
  routes: readonly AgentWriteRoute[] = AGENT_WRITE_ROUTES,
): boolean {
  return writeEntry(route, routes)?.target === 'client';
}

export function agentBodyNamesGuardedField(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return BUILTIN_CLIENT_GUARDED_FIELDS.some((field) => Object.hasOwn(body, field));
}

const ROUTE_KEYS: ReadonlySet<string> = new Set(
  ADMIN_ROUTES.map((route) => `${route.method} ${route.pattern}`),
);

export function isAdminRouteKey(candidate: string): boolean {
  return ROUTE_KEYS.has(candidate);
}

// What an agent that reached the admin API directly calls itself in the audit
// trail: the door cannot know a tool's name, so it is the route's, in the
// vocabulary's tool charset and length. `GET /admin/tenants/:tenant/clients/:id`
// is `admin.get.clients.id`. The full route key is recorded beside it.
export function doorToolName(routeKey: string): string {
  const [method = '', path = ''] = routeKey.split(' ');
  const rest = path
    .replace(/^\/admin(?:\/tenants\/:tenant)?\/?/u, '')
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => segment.replace(/^:/u, ''))
    .join('.');
  const named = `admin.${method.toLowerCase()}.${rest === '' ? 'tenant' : rest}`;
  return named
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, '_')
    .slice(0, 64);
}
