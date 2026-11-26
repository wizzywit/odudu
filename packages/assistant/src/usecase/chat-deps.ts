import type { RegisteredTool } from '@odudu/mcp';
import type { LanguageModel } from 'ai';
import type { ConversationMode } from '#/repository/conversations';
import type { AssistantTx } from '#/repository/tx';
import type { RunTurnDeps } from '#/usecase/run-turn';
import type { Entitlements } from '#/service/entitlements';
import type { LevelName, StopReason } from '#/service/limits';
import type { Slot } from '#/service/slots';
import type { WriteOutcome } from '#/service/tool-bridge';

/**
 * The signed-in administrator a request is made for, and the address the
 * server is reached at, as the admin API's door resolved them. The door has
 * already authenticated and authorised the request; nothing here is read from
 * the body.
 */
export interface ChatCaller {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly issuer: string;
  readonly ownerSubjectId: string;
  /** The grant behind the administrator's token: what an instance is derived from. */
  readonly grantId: string | undefined;
  readonly requestId: string;
  readonly ip: string;
}

/**
 * What the budget leaves in the audit trail as `assistant.budget`: a turn a
 * level refused, or a provider that charged more than was reserved. It names
 * who, where and which level, and never message text, a key or a token.
 */
export interface BudgetAuditEvent {
  readonly outcome: 'refused' | 'allowed';
  readonly tenantId: string;
  readonly subjectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly slot: Slot;
  readonly level?: LevelName;
  readonly stopReason?: StopReason;
  readonly overrunTokens?: number;
}

export type AccessOutcome<T> = { kind: 'granted'; value: T } | { kind: 'refused'; reason: string };

/** The card a decision is for: which conversation holds it and which tool it is about. */
export interface DecidedTarget {
  readonly conversationId: string;
  readonly tool: string;
}

export type WithdrawReason = 'superseded' | 'mode_changed' | 'stopped';

export type DecideResult =
  | { kind: 'decided'; state: 'approved' | 'denied' }
  | { kind: 'not_found' }
  | { kind: 'not_pending' };

/**
 * What the assistant needs of P5's approvals and of the write door, supplied by
 * the server, which sits above the packages that own them. Each call that
 * touches the assistant's own tables takes a closure that runs in the
 * transaction the server opens, so the two sets of rows move together.
 */
export interface ApprovalPorts {
  /**
   * Stores a pending approval for one proposed change, for the caller as its
   * owner, and runs `store` in the same transaction. Refused when the owner
   * already holds the most pending approvals allowed.
   */
  readonly open: <T>(
    caller: ChatCaller,
    input: {
      readonly conversationId: string;
      readonly tool: string;
      readonly input: unknown;
      readonly summary: string;
      readonly now: Date;
    },
    store: (tx: AssistantTx, opened: { approvalId: string; expiresAt: Date }) => Promise<T>,
  ) => Promise<{ kind: 'opened'; value: T } | { kind: 'refused'; reason: 'limit' }>;
  /**
   * Records the caller's decision as the approval's owner, from the console,
   * and the `assistant.approval` row with it. `load` names the card in the
   * same transaction; undefined means this conversation holds no such card.
   * `withdrawn` says the person moved on rather than answered.
   */
  readonly decide: (
    caller: ChatCaller,
    input: {
      readonly approvalId: string;
      readonly approve: boolean;
      readonly now: Date;
      readonly withdrawn?: WithdrawReason;
    },
    load: (tx: AssistantTx) => Promise<DecidedTarget | undefined>,
  ) => Promise<DecideResult>;
  /**
   * Runs one approved change: spends the approval for exactly this call,
   * gives it a grant of its own, makes it and ends the grant. `find` names the
   * approval the stored card holds for the call, or undefined where there is none.
   */
  readonly write: (
    caller: ChatCaller,
    input: {
      readonly conversationId: string;
      readonly toolCallId: string;
      readonly tool: string;
      readonly input: unknown;
      readonly now: Date;
      readonly signal?: AbortSignal | undefined;
    },
    find: (tx: AssistantTx) => Promise<string | undefined>,
  ) => Promise<WriteOutcome>;
}

export interface ChatDeps {
  /** Runs `fn` in one short transaction bound to the tenant. */
  readonly transact: <T>(tenantId: string, fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly model: (slot: Slot) => LanguageModel;
  readonly tools: readonly RegisteredTool[];
  /** How a turn of one of the caller's conversations gets a token and runs a tool. */
  readonly turn: (
    caller: ChatCaller,
    conversationId: string,
  ) => Pick<RunTurnDeps, 'mintToken' | 'callTool'>;
  /** The agent instance a conversation acts as under the run named `key`. */
  readonly instanceIdFor: (caller: ChatCaller, conversationId: string, key: string) => string;
  /**
   * Runs `fn` in the transaction that creates a conversation, after making the
   * conversation's own grant from the caller's console sign-in in that same
   * transaction, so there is never one without the other. The grant is stored
   * under the conversation's id. A refusal is returned, not thrown, and nothing
   * has been written when it is.
   */
  readonly withAccess: <T>(
    caller: ChatCaller,
    conversation: { readonly id: string; readonly mode: ConversationMode; readonly now: Date },
    fn: (tx: AssistantTx) => Promise<T>,
  ) => Promise<AccessOutcome<T>>;
  /** Present, Act mode can propose changes; absent, every conversation reads only. */
  readonly approvals?: ApprovalPorts;
  /** What a tenant may use; the open implementation reads the tenant's settings. */
  readonly entitlements?: Entitlements;
  /** Writes an `assistant.budget` row. A failure is logged and does not change the outcome. */
  readonly audit?: (event: BudgetAuditEvent) => Promise<void>;
  readonly now: () => Date;
  readonly newId: () => string;
  /** The most turns this process runs at once; 256 unless a test says otherwise. */
  readonly maxRunning?: number;
  /** The longest a turn may run before it is ended; five minutes unless a test says otherwise. */
  readonly turnDeadlineMs?: number;
  /** Where a failure the person is not told of is recorded: a name and details, never a key or token. */
  readonly log?: (event: string, detail: Record<string, unknown>) => void;
}

export const DEFAULT_MAX_RUNNING = 256;
export const DEFAULT_TURN_DEADLINE_MS = 300_000;
