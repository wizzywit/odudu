import { ASSISTANT_STOP_REASONS } from '@odudu/contracts/admin';
import type { Choice } from '#/shared/lib/services/choice';
import { ANY_STATUS } from '#/shared/lib/services/filters';
import { NOT_ANSWERED } from '#/pages/assistant-activity/services/activityText';
import type {
  ActivityKind,
  Tone,
  DecisionState,
  StopReason,
} from '#/pages/assistant-activity/types/activity';

const STOP_WORDS: Readonly<Record<StopReason, string>> = {
  done: 'Answered',
  step_cap: 'Step limit',
  awaiting_approval: 'Awaiting decision',
  budget_turn: 'Answer budget',
  budget_conversation: 'Conversation budget',
  budget_admin: 'Daily budget',
  budget_tenant: 'Monthly budget',
  aborted: 'Ended early',
  error: 'Failed',
};

const STOP_TONES: Readonly<Record<StopReason, Tone>> = {
  done: 'active',
  step_cap: 'warning',
  awaiting_approval: 'warning',
  budget_turn: 'warning',
  budget_conversation: 'warning',
  budget_admin: 'warning',
  budget_tenant: 'warning',
  aborted: 'neutral',
  error: 'danger',
};

export function stopWord(reason: StopReason | null): string {
  return reason === null ? NOT_ANSWERED : STOP_WORDS[reason];
}

export function stopTone(reason: StopReason | null): Tone {
  return reason === null ? 'neutral' : STOP_TONES[reason];
}

export const OUTCOME_CHOICES: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any outcome' },
  ...ASSISTANT_STOP_REASONS.map((reason) => ({ id: reason, label: STOP_WORDS[reason] })),
];

const KIND_WORDS: Readonly<Record<ActivityKind, string>> = {
  approval: 'Conversations that proposed a change',
  budget_refusal: 'Answers a budget refused',
  tool_error: 'Conversations where a tool failed',
};

export const KIND_CHOICES: readonly Choice[] = [
  { id: ANY_STATUS, label: 'All conversations' },
  ...(Object.keys(KIND_WORDS) as ActivityKind[]).map((kind) => ({
    id: kind,
    label: KIND_WORDS[kind],
  })),
];

// What a select shows for a filter the address names, or any.
export function choiceOf(filters: Readonly<Record<string, string>>, name: string): string {
  return filters[name] ?? ANY_STATUS;
}

export function approvalTone(state: DecisionState): Tone {
  return state === 'approved' || state === 'consumed' ? 'active' : 'neutral';
}
