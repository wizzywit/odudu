import type { AdminCapability } from '#/shared/lib/services/principal';

export interface ScopeRole {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  admin_reach: AdminCapability[];
}

export interface ScopeRoleList {
  items: ScopeRole[];
}
