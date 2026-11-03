import type { HeldAdminCapability } from '#/shared/lib/types/capabilities';
import { holdingLabel, includedBy } from '#/shared/lib/services/capabilities';

export interface HeldLine {
  holding: string;
  label: string;
  how: string;
}

// What a listed holder holds: Full collapses what it carries, and
// manage-users view-users; which group or role carries the rest is the
// open editor's to say.
export function heldLines(held: readonly HeldAdminCapability[]): HeldLine[] {
  const names = held.map((each) => each.name);
  return held
    .filter((each) => includedBy(each.name, names) === null)
    .map((each) => ({
      holding: each.name,
      label: holdingLabel(each.name),
      how: each.direct ? 'directly' : 'through a group or role',
    }));
}
