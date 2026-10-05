import { type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { isAdminRole } from '#/shared/service/capabilities.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { type Confirmation } from '#/features/subjects/service/access.ts';
import { type Loaded } from '#/features/subjects/service/create.ts';

function under(path: string, mapped: string): boolean {
  return path === mapped || path.startsWith(`${mapped}/`);
}

// Whether a membership change takes manage-tenants away: it is held only
// through groups (its own, or Full's), some group the subject was in reached
// one of them, and none it is left in does. A role mapped to a group reaches
// every group beneath it.
export function takesTenants(
  effective: readonly EffectiveRoleAssignment[],
  before: readonly string[],
  after: readonly string[],
): boolean {
  const carriers = effective.filter(
    (role) => isAdminRole(role) && (role.name === 'manage-tenants' || role.name === 'tenant-admin'),
  );
  const otherwise = carriers.some((role) =>
    role.via.some(
      (via) =>
        via.kind === 'direct' || (via.kind === 'composite' && via.parent_name !== 'tenant-admin'),
    ),
  );
  const mapped = carriers.flatMap((role) =>
    role.via.flatMap((via) => (via.kind === 'group' ? [via.group_path] : [])),
  );
  if (otherwise || mapped.length === 0) return false;
  const reaches = (paths: readonly string[]): boolean =>
    paths.some((path) => mapped.some((group) => under(path, group)));
  return reaches(before) && !reaches(after);
}

export interface Membership {
  id: string;
  // The path, or the id where the group is known by nothing else yet.
  path: string;
  description: string | null;
}

export function membershipsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, { path: string; description?: string | null }>,
): Membership[] {
  return ids.map((id) => {
    const group = known.get(id);
    return { id, path: group?.path ?? id, description: group?.description ?? null };
  });
}

export function leftGroups(
  held: readonly { id: string; path: string }[],
  chosen: readonly string[],
): string[] {
  return held.filter((group) => !chosen.includes(group.id)).map((group) => group.path);
}

// Leaving a group of your own takes every role it carries with it.
export function leaveConfirmation(self: boolean, left: readonly string[]): Confirmation | null {
  if (!self || left.length === 0) return null;
  return {
    title: 'Leave groups of your own?',
    consequence: `You are leaving ${left.join(', ')}. Every role a group carries goes with it, admin capabilities among them, so this console may stop offering some of what it offers you now, and you may not be able to join again yourself.`,
    typed: null,
  };
}

export function groupsRemoveTenants(
  tenant: string,
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    tenant === SYSTEM_TENANT &&
    effective.status === 'ready' &&
    takesTenants(effective.data.items, before, after)
  );
}
