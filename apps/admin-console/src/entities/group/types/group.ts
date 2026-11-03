import type { AdminCapability } from '#/shared/lib/services/principal';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  default_for_new_subjects: boolean;
  path: string;
  created_at: string;
  admin_reach: AdminCapability[];
}

// What a group lists as, before the reach membership hands out.
export type GroupFields = Omit<Group, 'admin_reach'>;

// A group's own record adds what deleting it would take away, its subtree's
// reach included, and whether it or one beneath it is a default.
export interface GroupRecord extends Group {
  subtree_admin_reach: AdminCapability[];
  holds_default_group: boolean;
}
