// What the activity routes answer, shaped from the rows of the trace. Nothing
// here reads the database or the clock.
import {
  ACTIVITY_TOOLS_MAX,
  ASSISTANT_TOOL_NAME_PATTERN,
  REPORTED_OLD_DAYS,
  assistantApprovalCardSchema,
  assistantStopReasonSchema,
  type AssistantActivityConversation,
  type AssistantActivityReplay,
  type AssistantStopReason,
} from '@odudu/contracts/admin';
import type {
  ActivityConversationRow,
  ApprovalRow,
  AskedRow,
  EventRow,
  SlotTokens,
  StepRow,
  TurnAggregate,
  TurnRow,
} from '#/service/activity-rows';
import { cutText } from '#/service/cut';
import { TEXT_WITHHELD, withholdEvent } from '#/service/withhold-text';

type Replay = AssistantActivityReplay;
type ReplayTurn = Replay['turns'][number];
type ReplayEvent = ReplayTurn['events'][number];
type ReplayApproval = Replay['approvals'][number];
type WhyModel = ReplayTurn['why_model'][number];

const WHY_DETAIL_MAX = 300;

/** The stop reason the vocabulary names, or none for a value it does not. */
export function stopReasonOf(value: string | null): AssistantStopReason | null {
  const parsed = assistantStopReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const DAY_MS = 86_400_000;

// A tool name is the model's to write until it matches the catalogue's spelling.
export function isToolName(name: string): boolean {
  return ASSISTANT_TOOL_NAME_PATTERN.test(name);
}

export interface SummaryParts {
  readonly turns: TurnAggregate | undefined;
  readonly slots: SlotTokens | undefined;
  readonly tools: readonly string[] | undefined;
  readonly approvals: number | undefined;
  readonly now: Date;
  /** Whether the tenant lets auditors read text, which a title is. */
  readonly text: boolean;
}

export function summaryOf(
  row: ActivityConversationRow,
  parts: SummaryParts,
): AssistantActivityConversation {
  const tokens = parts.slots?.tokens ?? {};
  return {
    id: row.id,
    person: row.ownerSubjectId,
    person_username: null,
    profile: row.profile,
    mode: row.mode === 'act' ? 'act' : 'ask',
    title: parts.text || row.title === null ? row.title : TEXT_WITHHELD,
    started_at: row.createdAt.toISOString(),
    last_active_at: row.lastActiveAt.toISOString(),
    turns: parts.turns?.turns ?? 0,
    steps: parts.slots?.steps ?? 0,
    tokens: { fast: tokens.fast ?? 0, standard: tokens.standard ?? 0, deep: tokens.deep ?? 0 },
    stop_reason: stopReasonOf(parts.turns?.lastStop ?? null),
    tools: (parts.tools ?? []).filter(isToolName).slice(0, ACTIVITY_TOOLS_MAX),
    approvals: parts.approvals ?? 0,
    reported_at: row.reportedAt?.toISOString() ?? null,
    report_old:
      row.reportedAt !== null &&
      parts.now.getTime() - row.reportedAt.getTime() > REPORTED_OLD_DAYS * DAY_MS,
  };
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// The slot choices the turn recorded, in the order it made them.
function whyModelOf(events: readonly EventRow[]): WhyModel[] {
  return events
    .filter((event) => event.kind === 'slot_chosen')
    .map((event) => {
      const payload = recordOf(event.payload);
      const provider = textOf(payload.provider);
      const model = textOf(payload.model_id);
      return {
        slot: textOf(payload.slot),
        reason: textOf(payload.reason),
        model: model === null || provider === null ? model : `${provider}/${model}`,
      };
    });
}

const LEVELS: Readonly<Record<string, string>> = {
  tenant_month: 'the tenant’s monthly allowance',
  admin_day: 'the person’s share of the day’s allowance',
  conversation: 'the most one conversation may use in a month',
  turn: 'the most one answer may use',
};

function lastEvent(events: readonly EventRow[], kind: string): EventRow | undefined {
  return events.findLast((event) => event.kind === kind);
}

function refusalDetail(events: readonly EventRow[]): string {
  const refused = events.findLast(
    (event) => event.kind === 'reservation' && recordOf(event.payload).outcome === 'refused',
  );
  const payload = recordOf(refused?.payload);
  const level = textOf(payload.level);
  const slot = textOf(payload.slot);
  if (level === null) return 'A budget level had no room for the next model call.';
  const named = LEVELS[level] ?? level;
  return `The next model call was refused because ${named}${slot === null ? '' : ` for the ${slot} model`} had no room.`;
}

function errorDetail(events: readonly EventRow[]): string {
  const payload = recordOf(lastEvent(events, 'error')?.payload);
  const name = textOf(payload.name);
  if (name === null) return 'The turn failed.';
  const message = textOf(payload.message);
  const said = message === null || message === '' ? name : `${name}: ${message}`;
  return `The turn failed. ${cutText(said, WHY_DETAIL_MAX)}`;
}

/** Why the turn ended, in the server’s words, from the choices and failures it recorded. */
export function whyStoppedOf(
  turn: TurnRow,
  events: readonly EventRow[],
  steps: readonly StepRow[],
  withheld = false,
): string {
  const reason = stopReasonOf(turn.stopReason);
  switch (reason) {
    case 'done':
      return 'The model finished its answer.';
    case 'step_cap':
      return `The turn reached its limit of ${String(steps.length)} model calls and stopped.`;
    case 'awaiting_approval': {
      const named = textOf(recordOf(lastEvent(events, 'policy')?.payload).tool);
      const tool = named !== null && isToolName(named) ? named : null;
      return `A change${tool === null ? '' : ` (${tool})`} waited for the person’s decision.`;
    }
    case 'budget_turn':
    case 'budget_conversation':
    case 'budget_admin':
    case 'budget_tenant':
      return refusalDetail(events);
    case 'aborted':
      return 'The turn was ended before it finished.';
    case 'error':
      return withheld ? 'The turn failed.' : errorDetail(events);
    case null:
      return turn.endedAt === null
        ? 'The turn has not ended: it may still be running, or its record stopped short.'
        : 'The turn ended without a reason recorded.';
  }
}

function eventOf(event: EventRow): ReplayEvent {
  return {
    seq: event.seq,
    step_id: event.stepId,
    kind: event.kind as ReplayEvent['kind'],
    at: event.at.toISOString(),
    payload: recordOf(event.payload),
  };
}

export function replayTurnOf(
  turn: TurnRow,
  steps: readonly StepRow[],
  events: readonly EventRow[],
  withheld: boolean,
): ReplayTurn {
  const shown = events.map(eventOf).map((event) => (withheld ? withholdEvent(event) : event));
  return {
    id: turn.id,
    prompt_hash: turn.promptHash,
    started_at: turn.startedAt.toISOString(),
    ended_at: turn.endedAt?.toISOString() ?? null,
    stop_reason: stopReasonOf(turn.stopReason),
    why_model: whyModelOf(events),
    why_stopped: whyStoppedOf(turn, events, steps, withheld),
    steps: steps.map((step) => ({
      id: step.id,
      parent_step_id: step.parentStepId,
      slot: step.slot as ReplayTurn['steps'][number]['slot'],
      model: step.model,
      provider_request_id: step.providerRequestId,
      input_tokens: step.inputTokens,
      output_tokens: step.outputTokens,
      started_at: step.startedAt.toISOString(),
      ended_at: step.endedAt?.toISOString() ?? null,
    })),
    events: shown,
  };
}

const cardWords = assistantApprovalCardSchema.pick({ title: true, target: true });

// What a change was aimed at, as one phrase: its kind and the name, or the id
// where the server read no name.
function targetText(target: {
  type: string;
  id?: string | undefined;
  name?: string | undefined;
}): string {
  const named = target.name ?? target.id;
  return named === undefined ? target.type : `${target.type} ${named}`;
}

export function replayConversationOf(row: ActivityConversationRow): Replay['conversation'] {
  return {
    id: row.id,
    person: row.ownerSubjectId,
    person_username: null,
    profile: row.profile,
    mode: row.mode === 'act' ? 'act' : 'ask',
    started_at: row.createdAt.toISOString(),
    last_active_at: row.lastActiveAt.toISOString(),
    reported_at: row.reportedAt?.toISOString() ?? null,
  };
}

export function replayApprovalOf(row: ApprovalRow, text: boolean): ReplayApproval {
  const card = cardWords.safeParse(row.card);
  return {
    id: row.id,
    tool_call_id: row.toolCallId,
    tool: row.tool,
    title: card.success ? card.data.title : null,
    target: card.success && text ? targetText(card.data.target) : null,
    state: row.state as ReplayApproval['state'],
    decided_at: row.decidedAt?.toISOString() ?? null,
  };
}

/** The text of a stored message's text parts, or none when it has any other kind. */
export function askedTextOf(row: AskedRow): string | null {
  if (!Array.isArray(row.parts)) return null;
  const texts = row.parts.flatMap((part: unknown) => {
    const record = recordOf(part);
    const text = record.type === 'text' ? textOf(record.text) : null;
    return text === null ? [] : [text];
  });
  return texts.length === 0 ? null : texts.join('\n');
}
