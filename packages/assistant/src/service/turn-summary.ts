import type { StopReason } from '#/service/limits';
import type { Slot } from '#/service/slots';

// The conversation's mode, spelled here because a service imports no repository.
export type TurnMode = 'ask' | 'act';

export type TurnOutcome = 'allowed' | 'refused' | 'failed';

/**
 * What the audit trail keeps of one turn: who, which conversation and turn,
 * the profile and mode it ran under, the slots and tokens it used, how many
 * steps it took and why it ended. It has no field for message text, tool
 * output, the names of tenant objects or a key, so none can reach the trail.
 */
export interface TurnSummary {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly profile: string;
  readonly mode: TurnMode;
  readonly slots: readonly Slot[];
  readonly tokensBySlot: Readonly<Partial<Record<Slot, number>>>;
  readonly steps: number;
  readonly stopReason: StopReason;
  readonly outcome: TurnOutcome;
}

/** The row written before a turn does anything: the same names, with nothing yet used. */
export type TurnStart = Pick<
  TurnSummary,
  'tenantId' | 'subjectId' | 'conversationId' | 'turnId' | 'profile' | 'mode' | 'slots'
>;

/** Which of the audit trail's outcomes a turn's ending is: a limit refused it, an error failed it. */
export function turnOutcomeOf(stopReason: StopReason): TurnOutcome {
  if (stopReason.startsWith('budget_')) return 'refused';
  return stopReason === 'error' ? 'failed' : 'allowed';
}

export interface TurnFacts {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly profile: string;
  readonly mode: TurnMode;
  readonly slot: Slot;
  readonly steps: number;
  readonly tokens: number;
  readonly stopReason: StopReason;
}

export function startOf(facts: Omit<TurnFacts, 'steps' | 'tokens' | 'stopReason'>): TurnStart {
  const { tenantId, subjectId, conversationId, turnId, profile, mode, slot } = facts;
  return { tenantId, subjectId, conversationId, turnId, profile, mode, slots: [slot] };
}

export function summaryOf(facts: TurnFacts): TurnSummary {
  const { slot, tokens, ...rest } = facts;
  return {
    ...rest,
    slots: [slot],
    tokensBySlot: { [slot]: tokens },
    outcome: turnOutcomeOf(facts.stopReason),
  };
}
