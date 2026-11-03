import { TENANT_NAME_RULE } from '@odudu/contracts';
import type { AdminCapability } from '#/shared/lib/types/capabilities';
import { sentence } from '#/shared/lib/services/format';

export type { AdminCapability };

// What whoami says the principal holds on one tenant: advice for what to
// render, never authority, since every request is authorised by the server.
export interface Authority {
  capabilities: readonly AdminCapability[];
  crossTenant: boolean;
}

export const SYSTEM_TENANT = 'system';

export { isTenantName } from '@odudu/contracts';

export const TENANT_NAME_RULE_TEXT = sentence(TENANT_NAME_RULE);
