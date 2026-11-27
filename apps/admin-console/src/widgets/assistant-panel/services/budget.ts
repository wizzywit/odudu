import { assistantBudgetWarningSchema, assistantTurnEndSchema } from '@odudu/contracts/admin';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type {
  AssistantBudgetLevel,
  AssistantBudgetWarning,
  AssistantStopReason,
  Meter,
  MeterState,
  TurnEnd,
} from '#/widgets/assistant-panel/types/chat';

export function readTurnEnd(data: unknown): TurnEnd | null {
  const parsed = assistantTurnEndSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function readBudgetWarning(data: unknown): AssistantBudgetWarning | null {
  const parsed = assistantBudgetWarningSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

// What a data part of the stream says: how the turn ended, or that a level
// passed the warning share. Any other data part says nothing the panel reads.
export function readStreamPart(part: { type: string; data?: unknown }): {
  turn?: TurnEnd;
  warning?: AssistantBudgetWarning;
} {
  if (part.type === 'data-turn_end') {
    const turn = readTurnEnd(part.data);
    return turn === null ? {} : { turn };
  }
  if (part.type === 'data-budget_warning') {
    const warning = readBudgetWarning(part.data);
    return warning === null ? {} : { warning };
  }
  return {};
}

const STOPPED_LEVEL: Readonly<Partial<Record<AssistantStopReason, AssistantBudgetLevel>>> = {
  budget_tenant: 'tenant_month',
  budget_admin: 'admin_day',
  budget_conversation: 'conversation',
  budget_turn: 'turn',
};

// The allowance a stop reason names, or undefined for a reason that is not one.
export function budgetLevelOf(reason: AssistantStopReason): AssistantBudgetLevel | undefined {
  return STOPPED_LEVEL[reason];
}

const NAMES: Readonly<Record<AssistantBudgetLevel, string>> = {
  tenant_month: 'this tenant’s monthly allowance',
  admin_day: 'your share of today’s allowance',
  conversation: 'this conversation’s allowance',
  turn: 'this answer’s allowance',
};

export function budgetName(level: AssistantBudgetLevel): string {
  return NAMES[level];
}

const NOTES: Readonly<Record<AssistantBudgetLevel, string>> = {
  tenant_month:
    'This tenant has used its monthly allowance, so the assistant stopped. A tenant administrator can raise it in Settings, under Console assistant; it starts over at the beginning of the next month, UTC.',
  admin_day:
    'You have used your share of today’s allowance, so the assistant stopped. It starts over at midnight UTC. A tenant administrator can raise the monthly allowance in Settings.',
  conversation:
    'This conversation has reached the most it may use in a month, so the assistant stopped. Start a new conversation to carry on.',
  turn: 'This answer reached the most one answer may use, so the assistant stopped part way. Ask again, with a narrower question, to continue.',
};

// What a stopped turn tells the person: the server's own sentence when it sent
// one, and the same facts from here when it did not.
export function budgetNote(level: AssistantBudgetLevel, fromServer: string | null): string {
  return fromServer === null || fromServer.trim() === '' ? NOTES[level] : fromServer;
}

export const NO_METER: MeterState = { warning: null, refused: null, fresh: false };

export type MeterEvent =
  | { kind: 'start' }
  | { kind: 'warning'; warning: AssistantBudgetWarning }
  | { kind: 'turn'; turn: TurnEnd };

// What the server has said about the allowance, kept across turns: a warning
// stays until a turn ends well without one, and a refusal until a turn ends
// well, so sending again never wipes what is still true.
export function nextMeter(previous: MeterState, event: MeterEvent): MeterState {
  if (event.kind === 'start') return { ...previous, fresh: false };
  if (event.kind === 'warning') return { ...previous, warning: event.warning, fresh: true };
  const level = budgetLevelOf(event.turn.stopReason);
  if (level !== undefined) return { ...previous, refused: level };
  if (event.turn.stopReason === 'done') {
    return { warning: previous.fresh ? previous.warning : null, refused: null, fresh: false };
  }
  return previous;
}

// The server sends the share of a level at which it warned and the level that
// refused, and no usage figures: so this says that much, and nothing at all
// when it has said neither.
export function meterOf(state: MeterState): Meter | null {
  if (state.refused !== null) {
    return {
      level: 'refused',
      text: `${PANEL_WORDING.meterRefused}: ${budgetName(state.refused)}`,
      percent: null,
    };
  }
  if (state.warning === null) return null;
  const percent = Math.floor(state.warning.percent);
  return {
    level: 'warning',
    text: `${String(percent)}% of ${budgetName(state.warning.level)} used`,
    percent,
  };
}
