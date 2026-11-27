import { groupedNumber } from '#/shared/lib/services/format';
import { stopWord } from '#/pages/assistant-activity/services/outcome';
import type {
  ReplayEvent,
  ReplayStep,
  ReplayTurn,
  StopReason,
} from '#/pages/assistant-activity/types/activity';

// How much of a call's input or a tool's result one entry shows, and how many
// entries of a turn are drawn before the rest wait behind a button.
export const BODY_MAX = 2_000;
export const EVENTS_PAGE = 100;

const PAIRS_MAX = 6;
const VALUE_MAX = 80;

export interface EventView {
  key: string;
  kind: string;
  label: string;
  detail: string | null;
  body: string | null;
  // The body was longer than is shown.
  cut: boolean;
}

export interface StepView {
  id: string;
  heading: string;
  meta: string;
  tokens: string;
  events: readonly EventView[];
}

export interface TurnView {
  id: string;
  title: string;
  startedAt: string;
  open: boolean;
  stopReason: StopReason | null;
  outcome: string;
  whyStopped: string;
  whyModels: readonly string[];
  decisions: readonly EventView[];
  steps: readonly StepView[];
  // Entries of the turn that are beyond what is drawn.
  notShown: number;
  // How many of them the next press of "Show more" draws.
  nextCount: number;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function shortValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > VALUE_MAX ? `${value.slice(0, VALUE_MAX)}…` : value;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

// The plain facts of a payload, as "name value" pairs: what the server wrote as
// names and counts, never an object or a long string.
function pairs(
  payload: Readonly<Record<string, unknown>>,
  skip: readonly string[] = [],
): string | null {
  const shown = Object.entries(payload)
    .filter(([name]) => !skip.includes(name))
    .flatMap(([name, value]) => {
      const said = shortValue(value);
      return said === null ? [] : [`${name.replaceAll('_', ' ')} ${said}`];
    })
    .slice(0, PAIRS_MAX);
  return shown.length === 0 ? null : shown.join(' · ');
}

function bodyOf(value: unknown): { body: string | null; cut: boolean } {
  if (value === undefined || value === null) return { body: null, cut: false };
  const said = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (said === '') return { body: null, cut: false };
  return said.length > BODY_MAX
    ? { body: said.slice(0, BODY_MAX), cut: true }
    : { body: said, cut: false };
}

function toolOf(payload: Readonly<Record<string, unknown>>): string {
  return text(payload.tool) ?? 'a tool';
}

function msOf(payload: Readonly<Record<string, unknown>>): string | null {
  const ms = payload.ms;
  return typeof ms === 'number' ? `${groupedNumber(ms)} ms` : null;
}

interface Said {
  label: string;
  detail: string | null;
  body?: unknown;
}

function said(event: ReplayEvent): Said {
  const { payload } = event;
  switch (event.kind) {
    case 'model_call':
      return { label: 'Model call', detail: pairs(payload) };
    case 'text':
      return { label: 'Said', detail: null, body: payload.text };
    case 'tool_call':
      return { label: `Called ${toolOf(payload)}`, detail: null, body: payload.input };
    case 'tool_result':
      return { label: `Result of ${toolOf(payload)}`, detail: msOf(payload), body: payload.output };
    case 'tool_error':
      return { label: `${toolOf(payload)} failed`, detail: msOf(payload), body: payload.error };
    case 'error':
      return {
        label: `The turn failed${text(payload.name) === null ? '' : `: ${text(payload.name) ?? ''}`}`,
        detail: null,
        body: payload.message,
      };
    case 'slot_chosen':
      return {
        label: `Chose the ${text(payload.slot) ?? 'a'} model`,
        detail: pairs(payload, ['slot']),
      };
    case 'reservation':
      return {
        label: payload.outcome === 'refused' ? 'A budget refused the next call' : 'Budget reserved',
        detail: pairs(payload, ['outcome']),
      };
    case 'narrowing':
      return { label: 'Narrowed the tools', detail: pairs(payload) };
    case 'policy':
      return { label: `Change policy for ${toolOf(payload)}`, detail: pairs(payload, ['tool']) };
    case 'trimming':
      return { label: 'Trimmed the history', detail: pairs(payload) };
    case 'truncated':
      return { label: 'The rest of the turn was not kept', detail: pairs(payload) };
    default:
      return { label: event.kind.replaceAll('_', ' '), detail: pairs(payload) };
  }
}

export function eventView(event: ReplayEvent): EventView {
  const { label, detail, body } = said(event);
  return {
    key: String(event.seq),
    kind: event.kind,
    label,
    detail,
    ...bodyOf(body),
  };
}

function tokensText(step: ReplayStep): string {
  const said = (count: number | null): string => (count === null ? '—' : groupedNumber(count));
  return `${said(step.inputTokens)} in · ${said(step.outputTokens)} out`;
}

function stepView(step: ReplayStep, index: number, events: readonly EventView[]): StepView {
  return {
    id: step.id,
    heading: `Step ${String(index + 1)}`,
    meta: `${step.slot} · ${step.model}`,
    tokens: tokensText(step),
    events,
  };
}

function whyModelText(why: ReplayTurn['whyModel'][number]): string {
  const model = why.model ?? 'a model';
  const slot = why.slot === null ? '' : `${why.slot}: `;
  return `${slot}${model}${why.reason === null ? '' : ` because ${why.reason}`}`;
}

// A turn as it is drawn: its decisions, then each model call with what it did.
// Only the first `limit` entries of an open turn are drawn, so a turn that kept
// five hundred costs no more to show than one that kept a hundred, and a closed
// one draws none.
export function turnView(turn: ReplayTurn, number: number, open: boolean, limit: number): TurnView {
  const kept = open ? turn.events.slice(0, limit) : [];
  const left = open ? Math.max(0, turn.events.length - kept.length) : 0;
  const ids = new Set(turn.steps.map((step) => step.id));
  const under = (id: string) =>
    kept.filter((event) => event.stepId === id).map((event) => eventView(event));
  return {
    id: turn.id,
    title: `Answer ${String(number)}`,
    startedAt: turn.startedAt,
    open,
    stopReason: turn.stopReason,
    outcome: stopWord(turn.stopReason),
    whyStopped: turn.whyStopped,
    whyModels: turn.whyModel.map(whyModelText),
    decisions: kept
      .filter((event) => event.stepId === null || !ids.has(event.stepId))
      .map((event) => eventView(event)),
    steps: turn.steps.map((step, index) => stepView(step, index, under(step.id))),
    notShown: left,
    nextCount: Math.min(left, EVENTS_PAGE),
  };
}
