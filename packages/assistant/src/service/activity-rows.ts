// The rows the activity reads return, which the services that shape them read too.

// Resumes strictly after the conversation it names, newest activity first. The
// time is carried as the database prints it, so no precision is lost.
export interface ActivityPosition {
  readonly lastActiveAt: string;
  readonly id: string;
}

export interface ActivityConversationRow {
  readonly id: string;
  readonly ownerSubjectId: string;
  readonly profile: string;
  readonly mode: string;
  readonly title: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly reportedAt: Date | null;
  /** The tenant the conversation acts in, when not the one that holds it. */
  readonly targetTenantId: string | null;
  readonly position: ActivityPosition;
}

export interface TurnAggregate {
  readonly turns: number;
  readonly lastStop: string | null;
}

export interface SlotTokens {
  readonly steps: number;
  readonly tokens: Readonly<Record<string, number>>;
}

export interface TurnRow {
  readonly id: string;
  readonly profile: string;
  readonly promptHash: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly stopReason: string | null;
}

export interface StepRow {
  readonly id: string;
  readonly turnId: string;
  readonly parentStepId: string | null;
  readonly slot: string;
  readonly model: string;
  readonly providerRequestId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface EventRow {
  readonly turnId: string;
  readonly seq: number;
  readonly stepId: string | null;
  readonly kind: string;
  readonly payload: unknown;
  readonly at: Date;
}

export interface ApprovalRow {
  readonly id: string;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly card: unknown;
  readonly state: string;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedVia: string | null;
}

export interface AskedRow {
  readonly seq: number;
  readonly createdAt: Date;
  readonly parts: unknown;
}
