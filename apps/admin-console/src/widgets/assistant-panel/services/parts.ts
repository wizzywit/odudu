import { activityLine, durationText } from '#/widgets/assistant-panel/services/activity-lines';
import { outcomeOfStep } from '#/widgets/assistant-panel/services/approval';
import { splitBlocks } from '#/widgets/assistant-panel/services/blocks';
import { durationOf, NO_TIMES, type StepTimes } from '#/widgets/assistant-panel/services/stepTimes';
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
  if (state === undefined) return null;
  return {
    kind: 'tool',
    id: part.toolCallId,
    name,
    state,
    input: 'input' in part ? part.input : undefined,
    error: 'errorText' in part && typeof part.errorText === 'string' ? part.errorText : null,
  };
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

// One line for a step, from the tool's name and what has become of it.
export function stepText(name: string, state: StepState): string {
  return activityLine({ name, state }).text;
}

// The most of a call's arguments the expander shows; a longer one is cut and says so.
const RAW_MAX = 2_000;

// The call as it was sent, for the expander: the tool's name and the arguments
// the model gave, and the error it ended in. The result is not shown, since it
// is the tenant's data and the assistant's answer says what it found.
export function rawCall(name: string, input: unknown, error: string | null): string {
  const call = JSON.stringify({ tool: name, arguments: input ?? {} }, null, 2);
  const shown =
    call.length > RAW_MAX ? `${call.slice(0, RAW_MAX)}\n${PANEL_WORDING.stepRawCut}` : call;
  return error === null ? shown : `${shown}\n\n${PANEL_WORDING.stepRawError}: ${error}`;
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
  times: StepTimes = NO_TIMES,
): PanelMessage {
  const blocks: MessageBlock[] = groupParts(parts).map((group) =>
    group.kind === 'text'
      ? { kind: 'text', ...splitBlocks(group.text) }
      : {
          kind: 'steps',
          steps: group.steps.map((step): StepLine => {
            const ms = durationOf(times, step.id);
            return {
              id: step.id,
              name: step.name,
              text: stepText(step.name, step.state),
              label: STEP_LABELS[step.state],
              tone: STEP_TONES[step.state],
              state: step.state,
              duration: ms === null ? null : durationText(ms),
              raw: rawCall(step.name, step.input, step.error),
              outcome: outcomeOfStep(step.name, step.state),
            };
          }),
        },
  );
  const typed = parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n');
  return { id, role, parts, typed, blocks };
}
