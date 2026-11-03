import { type Role } from '@odudu/contracts/admin';
import { andList } from '#/shared/services/format';
import { isBuiltin } from '#/features/roles/services/roleDeletion';

export function defaultBlock(role: Role): string | null {
  if (isBuiltin(role)) {
    return 'A capability of the built-in admin client is never handed to every new subject.';
  }
  if (role.default_for_new_subjects || role.admin_reach.length === 0) return null;
  return `It reaches ${andList(role.admin_reach)}, and a role every new subject receives may reach no admin capability. Take those composites out of it first.`;
}
