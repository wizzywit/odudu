import type { Slot } from '#/service/slots';

/**
 * What a kind of turn is allowed to cost and where it runs: the slot its model
 * comes from and the most steps a turn may take before it must answer.
 */
export interface TaskProfile {
  readonly id: string;
  readonly slot: Slot;
  readonly maxSteps: number;
}

// Free chat starts on the standard slot, which every deployment has.
export const FREE_CHAT: TaskProfile = { id: 'free-chat', slot: 'standard', maxSteps: 8 };

const PROFILES: readonly TaskProfile[] = [FREE_CHAT];

/** The profile a conversation names, or undefined for one this server does not know. */
export function profileById(id: string): TaskProfile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}
