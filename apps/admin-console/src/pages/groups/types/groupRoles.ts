import type { AdminCapability } from '#/shared/lib/services/principal';

// A mapped role carries what it hands out, so a change to the mapping is
// judged without a read per role.
export interface GroupRole {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  admin_reach: AdminCapability[];
}

export interface GroupRoleList {
  items: GroupRole[];
}
