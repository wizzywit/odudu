import { assistantBudgetWarningSchema, assistantTurnEndSchema } from '@odudu/contracts/admin';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type {
  AssistantBudgetLevel,
  AssistantBudgetWarning,
  AssistantStopReason,
  Meter,
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

// The server sends no usage figures yet, only the share of a level at which it
// warned and the level that refused, so the meter says no more than that.
export function meterOf(warning: AssistantBudgetWarning | null, turn: TurnEnd | null): Meter {
  const stopped = turn === null ? undefined : budgetLevelOf(turn.stopReason);
  if (stopped !== undefined) {
    return {
      level: 'refused',
      text: `${PANEL_WORDING.meterRefused}: ${budgetName(stopped)}`,
      percent: null,
    };
  }
  if (warning === null) return { level: 'within', text: PANEL_WORDING.meterWithin, percent: null };
  const percent = Math.floor(warning.percent);
  return {
    level: 'warning',
    text: `${String(percent)}% of ${budgetName(warning.level)} used`,
    percent,
  };
}
