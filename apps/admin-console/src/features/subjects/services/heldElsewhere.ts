import { holdingLabel, includedBy, type Held, type Holding } from '#/shared/services/capabilities';
import { andList } from '#/shared/services/format';

export interface HeldElsewhere {
  label: string;
  through: string;
}

// A holding the subject has only through a group or a role that nests it,
// which only that group or role can take away.
export function heldElsewhere(
  held: ReadonlyMap<Holding, Held>,
  chosen: readonly string[],
): HeldElsewhere[] {
  return [...held]
    .filter(([holding, how]) => {
      if (how.direct || includedBy(holding, chosen) !== null) return false;
      return how.through.some((path) => !path.startsWith('within '));
    })
    .map(([holding, how]) => ({ label: holdingLabel(holding), through: how.through.join(', ') }));
}

export function elsewhereText(name: string, elsewhere: readonly HeldElsewhere[]): string {
  const held = andList(elsewhere.map((each) => `${each.label} ${each.through}`));
  return `${held}: only that group or role takes it away, on ${name}’s `;
}
