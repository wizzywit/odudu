import { type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import {
  isAdminRole,
  removalConfirmation,
  type Confirmation,
} from '#/shared/services/capabilities';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { type Loaded } from '#/shared/services/read';

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

// Leaving a group of your own takes every role it carries with it.
export function leaveConfirmation(self: boolean, left: readonly string[]): Confirmation | null {
  if (!self || left.length === 0) return null;
  return {
    title: 'Leave groups of your own?',
    consequence: `You are leaving ${left.join(', ')}. Every role a group carries goes with it, admin capabilities among them, so this console may stop offering some of what it offers you now, and you may not be able to join again yourself.`,
    typed: null,
  };
}

// Taking system administration from anybody comes before the leaving of
// groups of your own; either is asked first, a plain save is not.
export function groupsSaveConfirmation({
  name,
  self,
  removesTenants,
  left,
}: {
  name: string;
  self: boolean;
  removesTenants: boolean;
  left: readonly string[];
}): Confirmation | null {
  const removal = removesTenants
    ? removalConfirmation({ name, self, removed: ['manage-tenants'], removesTenants: true })
    : null;
  return removal ?? leaveConfirmation(self, left);
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
