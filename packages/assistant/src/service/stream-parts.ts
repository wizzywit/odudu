import type { AssistantApprovalCard } from '@odudu/contracts/admin';
import type { UIMessageChunk } from 'ai';
import { refusalFor, type LevelName, type Refusal, type StopReason } from '#/service/limits';
import type { Slot } from '#/service/slots';

// What a person is told when a turn fails for a reason that is not theirs to
// act on. The failure's own text stays in the log.
export const GENERIC_FAILURE = 'The assistant could not finish this answer. Please try again.';

/** The text of the stream's error part: the budget's words for a refusal, else a generic line. */
export function errorTextFor(refusal: Refusal | undefined, slot: Slot): string {
  return refusal === undefined ? GENERIC_FAILURE : refusalFor(refusal.level, slot).message;
}

/** A level has passed the warning share; sent once per level in a turn. */
export function budgetWarningChunk(warning: {
  level: LevelName;
  percent: number;
  slot: Slot;
}): UIMessageChunk {
  return { type: 'data-budget_warning', data: warning, transient: true };
}

/** The last part of every turn, naming why it ended in the one vocabulary the panel reads. */
export function turnEndChunk(stopReason: StopReason): UIMessageChunk {
  return { type: 'data-turn_end', data: { stopReason }, transient: true };
}

/**
 * The card for a change that waits for the person, sent beside the SDK's own
 * approval request: the title, the target, the state the server read and the
 * change, with the expiry by the server's clock. Built from the stored card,
 * never from the model's text.
 */
export function approvalCardChunk(card: AssistantApprovalCard): UIMessageChunk {
  return { type: 'data-approval_card', data: card, transient: true };
}
