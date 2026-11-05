import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { type AdminRoute } from '#/service/capability';

interface AgentWriteRoute {
  readonly method: 'PATCH';
  readonly pattern: string;
  readonly fields: readonly string[];
}

// What `mcp:write` adds to the reads: amending the wording a person reads,
// never what a client or scope may do. Admission is by field because the
// same PATCH carries `enabled`, `redirect_uris` and the rest for an ordinary
// caller. `consent_text` is left out on purpose: it is what a user agrees to.
export const AGENT_WRITE_ROUTES: readonly AgentWriteRoute[] = [
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    fields: ['name', 'client_name', 'description', 'name_i18n', 'description_i18n'],
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/scopes/:id',
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
    return scopes.includes(MCP_READ_SCOPE) || scopes.includes(MCP_WRITE_SCOPE);
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
