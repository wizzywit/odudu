import type { AgentInstance } from '#/pages/agents/types/agent';
import { OWNER_ONLY_ALL, ownerName, ownerNote } from '#/pages/agents/services/agentText';
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
  rows: readonly Pick<AgentInstance, 'owner' | 'ownerUsername'>[],
  clear: () => void,
): OwnerNarrowing | null {
  const owner = ownerFilterOf(filters);
  if (owner === null) return null;
  const named = rows.find((row) => row.owner === owner);
  return {
    note: ownerNote(ownerName(owner, named?.ownerUsername ?? null)),
    all: OWNER_ONLY_ALL,
    clear,
  };
}
