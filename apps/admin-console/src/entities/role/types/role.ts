import type { AdminCapability } from '#/shared/services/principal';

// The wire's field names are kept: other slices read `client_key` and
// `admin_reach` as they come.
export interface Role {
  id: string;
  name: string;
  description: string | null;
  // Null for a tenant role.
  client_id: string | null;
  // The owning client's own `client_id`, the name a person tells it apart by.
  client_key: string | null;
  default_for_new_subjects: boolean;
  created_at: string;
  // What the role hands out however deep it nests, derived on every read.
  admin_reach: AdminCapability[];
}
