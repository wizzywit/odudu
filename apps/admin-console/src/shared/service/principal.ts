import type { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

// Who is signed in, as GET /console/api/session reports it: the tenant is
// the one the session was issued by, which a system administrator carries
// into every tenant they enter.
export interface Principal {
  tenant: string;
  subjectId: string;
  username: string;
}

// What whoami says the principal holds on one tenant: advice for what to
// render, never authority, since every request is authorised by the server.
export interface Authority {
  capabilities: readonly AdminCapability[];
  crossTenant: boolean;
}

export const SYSTEM_TENANT = 'system';

export { isTenantName } from '@odudu/contracts';

export function isSelf(principal: Principal, tenant: string, subjectId: string): boolean {
  return principal.tenant === tenant && principal.subjectId === subjectId;
}
