import { holdsMcpScope, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

interface AgentWriteRoute {
  readonly method: 'PATCH';
  readonly pattern: string;
  readonly target: 'client' | 'scope';
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
// never what a client or scope may do. Admission is by field because the
// same PATCH carries `enabled`, `redirect_uris` and the rest for an ordinary
// caller. `consent_text` is left out on purpose: it is what a user agrees to.
export const AGENT_WRITE_ROUTES: readonly AgentWriteRoute[] = [
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    target: 'client',
    fields: ['name', 'description', 'name_i18n', 'description_i18n'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    target: 'scope',
    fields: ['description', 'description_i18n'],
  },
];

function writeEntry(route: Pick<AdminRoute, 'method' | 'pattern'>): AgentWriteRoute | undefined {
  return AGENT_WRITE_ROUTES.find(
    (entry) => entry.method === route.method && entry.pattern === route.pattern,
  );
}

export function scopeAdmits(
  scopes: readonly string[],
  route: AdminRoute,
  tenantIsSystem: boolean,
): boolean {
  if (route.method === 'GET') {
    const key = `${route.method} ${route.pattern}`;
    if (AGENT_DENIED_READS.includes(key)) return false;
    if (INSTANCE_READS.includes(key) && !tenantIsSystem) return false;
    return holdsMcpScope(scopes);
  }
  return scopes.includes(MCP_WRITE_SCOPE) && writeEntry(route) !== undefined;
}

export function agentWritableFields(route: AdminRoute): readonly string[] {
  return writeEntry(route)?.fields ?? [];
}

// Reads the body the handler will read, as parsed: a duplicate key is already
// its last value and `__proto__` an own key no allowlist names.
export function agentBodyAdmitted(route: AdminRoute, body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const writable = agentWritableFields(route);
  return Reflect.ownKeys(body).every((key) => typeof key === 'string' && writable.includes(key));
}

export function agentWritesClient(route: AdminRoute): boolean {
  return writeEntry(route)?.target === 'client';
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
