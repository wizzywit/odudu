import type {
  AssistantBudgetLevel,
  AssistantBudgetWarning,
  AssistantMode,
  AssistantPageContext,
  AssistantStopReason,
} from '@odudu/contracts/admin';

export type { AssistantBudgetLevel, AssistantBudgetWarning, AssistantMode, AssistantStopReason };
export type PageContext = AssistantPageContext;

// The kind of conversation a person starts. The server knows free chat only;
// a later profile is another id.
export type ProfileId = string;

export type StepState = 'running' | 'waiting' | 'done' | 'failed' | 'denied';

// What the log draws of one message part. Reasoning, sources, files and data
// parts are not drawn.
export type PanelPart =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      state: StepState;
      // The arguments the model gave, and the error the call ended in, if it did.
      input: unknown;
      error: string | null;
    };

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

export type HistoryState = 'none' | 'loading' | 'ready' | 'failed';

export interface TurnEnd {
  stopReason: AssistantStopReason;
}

export interface Failure {
  cause: string;
  // The request's own reference, when the server gave one.
  trace: string | null;
}

export type PanelState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'connecting' }
  | { kind: 'thinking' }
  | { kind: 'tool'; step: string }
  | { kind: 'waiting' }
  | { kind: 'stopped' }
  | { kind: 'step-limit' }
  | { kind: 'budget'; level: AssistantBudgetLevel }
  | { kind: 'failed'; failure: Failure }
  | { kind: 'finished' }
  // The stream closed with no word of how the turn ended.
  | { kind: 'closed' };

// What the server has said about the allowance, kept until it says otherwise.
export interface MeterState {
  warning: AssistantBudgetWarning | null;
  refused: AssistantBudgetLevel | null;
  // A warning came in the turn now running.
  fresh: boolean;
}

export interface Meter {
  level: 'warning' | 'refused';
  text: string;
  percent: number | null;
}

// One line of a list of steps, worded and toned for the view.
export interface StepLine {
  id: string;
  name: string;
  text: string;
  label: string;
  tone: 'neutral' | 'active' | 'warning' | 'danger';
  state: StepState;
  // How long the step took, when this panel watched it, as a short phrase.
  duration: string | null;
  // The call as it was sent, for the step's expander.
  raw: string;
  // What became of the approval a finished write step carried, if it was one.
  outcome: string | null;
}

// What a message is made of, as the log lays it out: answer text cut at the
// block still being written, and the steps that ran together.
export type MessageBlock =
  { kind: 'text'; settled: string[]; open: string } | { kind: 'steps'; steps: StepLine[] };

export interface PanelMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: readonly PanelPart[];
  // A person's own words, as typed.
  typed: string;
  blocks: MessageBlock[];
}
