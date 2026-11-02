import type { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

// What whoami says the principal holds on one tenant: advice for what to
// render, never authority, since every request is authorised by the server.
export interface Authority {
  capabilities: readonly AdminCapability[];
  crossTenant: boolean;
}

export const SYSTEM_TENANT = 'system';

export { isTenantName } from '@odudu/contracts';
