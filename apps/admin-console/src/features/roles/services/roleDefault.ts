import type { Role } from '#/entities/role';
import { blockedByDefault } from '#/shared/services/capabilities';
import { andList } from '#/shared/services/format';
import { isBuiltin } from '#/features/roles/services/roleDeletion';

export function defaultBlock(role: Role): string | null {
  if (isBuiltin(role)) {
    return 'A capability of the built-in admin client is never handed to every new subject.';
  }
  const blocked = blockedByDefault(!role.default_for_new_subjects, role.admin_reach);
  if (blocked.length === 0) return null;
  return `It reaches ${andList(blocked)}, and a role every new subject receives may reach no admin capability. Take those composites out of it first.`;
}

export const DEFAULT_LABEL = 'Given to every new subject';
