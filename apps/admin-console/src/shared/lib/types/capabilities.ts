import type { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';

export type {
  EffectiveRoleAssignment,
  HeldAdminCapability,
  RoleProvenance,
} from '@odudu/contracts/admin';

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];
