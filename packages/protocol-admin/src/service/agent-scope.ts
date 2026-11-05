import { holdsMcpScope, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

interface AgentWriteRoute {
  readonly method: 'PATCH';
  readonly pattern: string;
  readonly target: 'client' | 'scope';
  readonly fields: readonly string[];
}

// Reads an agent never gets, though a GET: each returns a whole tenant, or
// bytes, in one call, and a person fetches those with their own token.
export const AGENT_DENIED_READS: readonly string[] = [
  'GET /admin/tenants/:tenant/export',
  'GET /admin/tenants/:tenant/audit/export',
  'GET /admin/tenants/:tenant/theme/assets/:assetId/content',
];

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

export function scopeAdmits(scopes: readonly string[], route: AdminRoute): boolean {
  if (route.method === 'GET') {
    if (AGENT_DENIED_READS.includes(`${route.method} ${route.pattern}`)) return false;
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
