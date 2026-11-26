import { splitBlocks } from '#/widgets/assistant-panel/services/blocks';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type {
  MessageBlock,
  PanelMessage,
  PanelPart,
  StepLine,
  StepState,
} from '#/widgets/assistant-panel/types/chat';

const STATES: Readonly<Record<string, StepState>> = {
  'input-streaming': 'running',
  'input-available': 'running',
  'approval-responded': 'running',
  'approval-requested': 'waiting',
  'output-available': 'done',
  'output-error': 'failed',
  'output-denied': 'denied',
};

function toolNameOf(part: { type: string }): string | null {
  if (part.type === 'dynamic-tool') {
    return 'toolName' in part && typeof part.toolName === 'string' ? part.toolName : null;
  }
  return part.type.startsWith('tool-') && part.type.length > 5 ? part.type.slice(5) : null;
}

function readTool(part: { type: string }): PanelPart | null {
  const name = toolNameOf(part);
  if (name === null) return null;
  if (!('toolCallId' in part) || typeof part.toolCallId !== 'string') return null;
  if (!('state' in part) || typeof part.state !== 'string') return null;
  const state = STATES[part.state];
  return state === undefined ? null : { kind: 'tool', id: part.toolCallId, name, state };
}

// What the log draws of a message's parts, from a stored message or a streamed
// one. A part of a shape this does not know is skipped, never guessed at.
export function readParts(parts: readonly unknown[]): PanelPart[] {
  const read: PanelPart[] = [];
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    if (!('type' in part) || typeof part.type !== 'string') continue;
    if (part.type === 'text') {
      if ('text' in part && typeof part.text === 'string') {
        read.push({ kind: 'text', text: part.text });
      }
      continue;
    }
    const tool = readTool({ ...part, type: part.type });
    if (tool !== null) read.push(tool);
  }
  return read;
}

const VERBS: Readonly<Record<string, { doing: string; done: string }>> = {
  list: { doing: 'Listing', done: 'Listed' },
  get: { doing: 'Reading', done: 'Read' },
  count: { doing: 'Counting', done: 'Counted' },
};

function spaced(name: string): string {
  return name.replace(/_/gu, ' ');
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// One line for a step, from the tool's name: a read is said as a read, and
// anything else by its name with what became of it. Never the call's own
// arguments, which a model chose.
export function stepText(name: string, state: StepState): string {
  const [verb = '', ...rest] = name.split('_');
  const noun = rest.join(' ');
  const known = VERBS[verb];
  if (known !== undefined && noun !== '') {
    if (state === 'running') return `${known.doing} ${noun}`;
    if (state === 'done') return `${known.done} ${noun}`;
    if (state === 'failed') return `${known.doing} ${noun} failed`;
  }
  const label = sentenceCase(spaced(name));
  const outcome: Readonly<Record<StepState, string>> = {
    running: 'running',
    waiting: 'waiting for you',
    done: 'done',
    failed: 'failed',
    denied: 'refused',
  };
  return `${label}: ${outcome[state]}`;
}

type Tool = Extract<PanelPart, { kind: 'tool' }>;

export type PartGroup = { kind: 'text'; text: string } | { kind: 'steps'; steps: readonly Tool[] };

// The parts as the log lays them out: text as it comes, and the steps that
// follow one another drawn as one list.
export function groupParts(parts: readonly PanelPart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    if (part.kind === 'text') {
      groups.push(part);
    } else if (last?.kind === 'steps') {
      groups[groups.length - 1] = { kind: 'steps', steps: [...last.steps, part] };
    } else {
      groups.push({ kind: 'steps', steps: [part] });
    }
  }
  return groups;
}

const STEP_TONES: Readonly<Record<StepState, StepLine['tone']>> = {
  running: 'neutral',
  waiting: 'warning',
  done: 'active',
  failed: 'danger',
  denied: 'warning',
};

const STEP_LABELS: Readonly<Record<StepState, string>> = {
  running: PANEL_WORDING.stepRunning,
  waiting: PANEL_WORDING.stepWaiting,
  done: PANEL_WORDING.stepDone,
  failed: PANEL_WORDING.stepFailed,
  denied: PANEL_WORDING.stepDenied,
};

// A message as the log draws it: a person's words as typed, an answer as
// blocks of text and lists of steps.
export function drawMessage(
  id: string,
  role: 'user' | 'assistant',
  parts: readonly PanelPart[],
): PanelMessage {
  const blocks: MessageBlock[] = groupParts(parts).map((group) =>
    group.kind === 'text'
      ? { kind: 'text', ...splitBlocks(group.text) }
      : {
          kind: 'steps',
          steps: group.steps.map((step) => ({
            id: step.id,
            text: stepText(step.name, step.state),
            label: STEP_LABELS[step.state],
            tone: STEP_TONES[step.state],
          })),
        },
  );
  const typed = parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n');
  return { id, role, parts, typed, blocks };
}
