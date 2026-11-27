import type {
  ASSISTANT_APPROVAL_STATES,
  AssistantActivityKind,
  AssistantStopReason,
} from '@odudu/contracts/admin';

// How an outcome is toned where it is drawn as a tag.
export type Tone = 'neutral' | 'active' | 'warning' | 'danger';

export type Slot = 'fast' | 'standard' | 'deep';
export type Mode = 'ask' | 'act';
export type StopReason = AssistantStopReason;
export type ActivityKind = AssistantActivityKind;

export interface SlotTokens {
  fast: number;
  standard: number;
  deep: number;
}

export interface ActivityConversation {
  id: string;
  person: string;
  personName: string | null;
  profile: string;
  mode: Mode;
  title: string | null;
  startedAt: string;
  lastActiveAt: string;
  turns: number;
  steps: number;
  tokens: SlotTokens;
  stopReason: StopReason | null;
  tools: readonly string[];
  approvals: number;
  reportedAt: string | null;
  reportOld: boolean;
}

export interface ReplayStep {
  id: string;
  slot: Slot;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ReplayEvent {
  seq: number;
  stepId: string | null;
  kind: string;
  at: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface WhyModel {
  slot: string | null;
  reason: string | null;
  model: string | null;
}

export interface ReplayTurn {
  id: string;
  startedAt: string;
  endedAt: string | null;
  stopReason: StopReason | null;
  whyModel: readonly WhyModel[];
  whyStopped: string;
  steps: readonly ReplayStep[];
  events: readonly ReplayEvent[];
}

export type DecisionState = (typeof ASSISTANT_APPROVAL_STATES)[number];

export interface ReplayApproval {
  id: string;
  tool: string;
  title: string | null;
  target: string | null;
  state: DecisionState;
  decidedAt: string | null;
}

export interface Replay {
  id: string;
  person: string;
  personName: string | null;
  profile: string;
  mode: Mode;
  startedAt: string;
  lastActiveAt: string;
  reportedAt: string | null;
  asked: readonly { at: string; text: string }[];
  turns: readonly ReplayTurn[];
  turnsOmitted: number;
  textVisible: boolean;
  approvals: readonly ReplayApproval[];
}

export interface Reported {
  reportedAt: string;
  reportedCount: number;
  nearLimit: boolean;
}

// The test case as the server wrote it, kept as the text to save.
export interface ExportedCase {
  text: string;
  contentType: string | null;
}
