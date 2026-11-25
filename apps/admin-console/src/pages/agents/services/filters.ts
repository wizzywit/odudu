import { OWNER_ONLY_ALL, ownerNote } from '#/pages/agents/services/agentText';
import { ANY_STATUS } from '#/shared/lib/services/filters';

// What the state menu shows: the state the address names, or any.
export function stateChoice(filters: Readonly<Record<string, string>>): string {
  return filters.state ?? ANY_STATUS;
}

// The subject the list is narrowed to, if it is.
export function ownerFilterOf(filters: Readonly<Record<string, string>>): string | null {
  return filters.owner ?? null;
}

export interface OwnerNarrowing {
  note: string;
  all: string;
  clear: () => void;
}

// What the list says of being narrowed to one owner, with the way back to all.
export function ownerNarrowing(
  filters: Readonly<Record<string, string>>,
  clear: () => void,
): OwnerNarrowing | null {
  const owner = ownerFilterOf(filters);
  return owner === null ? null : { note: ownerNote(owner), all: OWNER_ONLY_ALL, clear };
}
