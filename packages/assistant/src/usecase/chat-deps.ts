import type { AssistantTier } from '@odudu/contracts/admin';
import type { RegisteredTool } from '@odudu/mcp';
import type { LanguageModel, Telemetry } from 'ai';
import type { ConversationMode } from '#/repository/conversations';
import type { AssistantTx } from '#/repository/tx';
import type { RunTurnDeps } from '#/usecase/run-turn';
import type { Entitlements } from '#/service/entitlements';
import type { LevelName, StopReason } from '#/service/limits';
import type { Slot } from '#/service/slots';
import type { TurnStart, TurnSummary } from '#/service/turn-summary';
import type { CapRefusal } from '#/service/approval-limits';
import type { FactsReader } from '#/service/tier';
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
  /**
   * The tenant the request's path names, when a system administrator uses the
   * assistant in a tenant other than their own: the tenant fields above stay the
   * administrator's, because the conversation, its grant and its budget are
   * rows of that tenant. Absent for a conversation in the caller's own tenant.
   */
  readonly target?: { readonly id: string; readonly name: string };
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
  /** The tenant the turn acted in, when it was not the owner's own. */
  readonly targetTenantId?: string;
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
  | { kind: 'not_pending' }
  // The card asks for a text the decision did not carry: nothing was recorded.
  | { kind: 'confirm_required' };

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
  ) => Promise<{ kind: 'opened'; value: T } | { kind: 'refused'; reason: 'limit' | CapRefusal }>;
  /**
   * Records the caller's decision as the approval's owner, from the console,
   * and the `assistant.approval` row with it. `load` names the card in the
   * same transaction; undefined means this conversation holds no such card.
   * `withdrawn` says the person moved on rather than answered.
   */
  readonly answer: (
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
   * Closes an approved change that is not run because what it would change moved
   * since the person approved: spends the approval, so it cannot run later, and
   * leaves a row saying the state moved. `find` names the approval as for `write`.
   */
  readonly retire: (
    caller: ChatCaller,
    input: {
      readonly conversationId: string;
      readonly tool: string;
      readonly input: unknown;
      readonly now: Date;
      readonly reason: 'state_moved' | 'human_only';
    },
    find: (tx: AssistantTx) => Promise<string | undefined>,
  ) => Promise<void>;
  /**
   * Runs one approved change: spends the approval for exactly this call,
   * gives it a grant of its own, makes it and ends the grant. `find` names the
   * approval the stored card holds for the call, or undefined where there is none.
   */
  readonly write: (
    caller: ChatCaller,
    input: {
      readonly conversationId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly tool: string;
      readonly input: unknown;
      // What the card asked of the person; a tier C change is counted apart.
      readonly tier: AssistantTier;
      readonly now: Date;
      readonly signal?: AbortSignal | undefined;
    },
    find: (tx: AssistantTx) => Promise<string | undefined>,
  ) => Promise<WriteOutcome>;
}

/**
 * What a person's deleting or exporting a conversation leaves in the audit
 * trail: who, which conversation and what it held, and never its text.
 */
export type ConversationAuditEvent =
  | {
      readonly action: 'assistant.conversation_deleted';
      readonly conversationId: string;
      readonly targetTenantId?: string;
      readonly messageCount: number;
      readonly turnCount: number;
      readonly digest: string;
    }
  | {
      readonly action: 'assistant.conversation_exported';
      readonly conversationId: string;
      readonly targetTenantId?: string;
      readonly format: 'json' | 'markdown';
      readonly messageCount: number;
      readonly truncated: boolean;
    };

/**
 * What deleting and exporting a conversation need of the server, which holds the
 * audit trail. Absent, neither is offered. `withAudit` runs `fn` in one
 * transaction bound to the caller's tenant with a way to write an audit row in
 * that same transaction, so a delete or an export and its row stand or fall together.
 */
export interface ConversationPorts {
  readonly withAudit: <T>(
    caller: ChatCaller,
    fn: (tx: AssistantTx, record: (event: ConversationAuditEvent) => Promise<void>) => Promise<T>,
  ) => Promise<T>;
  /** The key a deleted conversation's digest is made under; see `deriveDigestKey`. */
  readonly digestKey: Uint8Array;
  /**
   * Ends the conversation's own grant and what was derived from it, after the
   * conversation is deleted. A failure is logged and changes nothing the person saw:
   * the grant holds no text and ends with the sign-in it came from.
   */
  readonly endAccess?: (
    caller: ChatCaller,
    conversationId: string,
    now: Date,
    grantId: string,
  ) => Promise<void>;
}

/** What a conversation's grant is replaced under: its old grant and what the new one may hold. */
export interface ReattachInput {
  readonly conversationId: string;
  readonly previousGrantId: string;
  readonly newGrantId: string;
  readonly mode: ConversationMode;
  readonly archived: boolean;
  readonly now: Date;
}

/**
 * `live`: the conversation's grant is live and came from the caller's sign-in.
 * `attached`: a new grant was made from it and the old one ended, and the
 * `assistant.reattached` row was written, all in the transaction given.
 * `refused`: a fixed code, with an `assistant.access_refused` row and nothing else written.
 */
export type ReattachResult =
  | { readonly kind: 'live' }
  | { readonly kind: 'attached'; readonly grantId: string }
  | { readonly kind: 'refused'; readonly code: string };

/** Replaces a conversation's grant in the transaction that `ChatBase.reattach` opened. */
export type Reattacher = (input: ReattachInput) => Promise<ReattachResult>;

interface ChatBase {
  /** Runs `fn` in one short transaction bound to the tenant. */
  readonly transact: <T>(tenantId: string, fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly model: (slot: Slot) => LanguageModel;
  readonly tools: readonly RegisteredTool[];
  /**
   * What the server knows of a target, for the caller's conversations: whether a
   * change that asks more than tier A may be proposed at all. Absent, only tier A
   * changes are proposed.
   */
  readonly targetFacts?: (caller: ChatCaller) => FactsReader;
  /**
   * How a turn of one of the caller's conversations gets a token and runs a tool.
   * `turnId` names the turn, so each tool call's audit row can carry it.
   */
  readonly turn: (
    caller: ChatCaller,
    conversationId: string,
    turnId: string,
  ) => Pick<RunTurnDeps, 'mintToken' | 'callTool'>;
  /**
   * Writes the `assistant.turn` row that opens a turn, in a short transaction of
   * its own (the server holds the audit repository, whose transaction is not the
   * assistant's). A throw stops the turn before the model is called or anything
   * is reserved.
   */
  readonly recordTurnStart: (start: TurnStart) => Promise<void>;
  /**
   * Writes the `assistant.turn` row that closes a turn: the slots and tokens it
   * used, its steps and why it ended. A failure is logged and changes nothing
   * the person saw.
   */
  readonly recordTurn: (summary: TurnSummary) => Promise<void>;
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
  /** Deleting and exporting a person's own conversations; see `ConversationPorts`. */
  readonly conversations?: ConversationPorts;
  /**
   * Carries a conversation on under the sign-in the caller holds now. Reads what
   * the new grant's checks need (the tenant, the target), then runs `step` in one
   * transaction bound to the tenant with the means to replace the conversation's
   * grant in that same transaction. Absent, every conversation keeps the grant it has.
   */
  readonly reattach?: <T>(
    caller: ChatCaller,
    step: (tx: AssistantTx, reattach: Reattacher) => Promise<T>,
  ) => Promise<T>;
  /**
   * Whether a message to the conversation would be answered under the sign-in the
   * caller holds now, live or after it is carried on, without changing anything.
   * Absent, every conversation counts as continuable.
   */
  readonly continuable?: (caller: ChatCaller, conversationId: string) => Promise<boolean>;
  /** What a tenant may use; the open implementation reads the tenant's settings. */
  readonly entitlements?: Entitlements;
  /** Writes an `assistant.budget` row. A failure is logged and does not change the outcome. */
  readonly audit?: (event: BudgetAuditEvent) => Promise<void>;
  /**
   * Integrations that receive a turn's events beside the trace recorder, for an
   * operator's exporter. A turn's integrations are passed for that call and
   * replace any registered globally, so one registered globally gets none.
   */
  readonly telemetry?: readonly Telemetry[];
  /** Secrets the server holds, such as the provider's keys; they never reach the trace. */
  readonly knownSecrets?: readonly string[];
  readonly now: () => Date;
  readonly newId: () => string;
  /** The most turns this process runs at once; 256 unless a test says otherwise. */
  readonly maxRunning?: number;
  /** The longest a turn may run before it is ended; five minutes unless a test says otherwise. */
  readonly turnDeadlineMs?: number;
  /** Where a failure the person is not told of is recorded: a name and details, never a key or token. */
  readonly log?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * Act mode needs both its ports and the secret that signs a pending request, or
 * neither: a deployment cannot propose changes it cannot sign.
 */
export type ChatDeps = ChatBase &
  (
    | { readonly approvals: ApprovalPorts; readonly approvalSecret: Uint8Array }
    | { readonly approvals?: undefined; readonly approvalSecret?: undefined }
  );

export const DEFAULT_MAX_RUNNING = 256;
export const DEFAULT_TURN_DEADLINE_MS = 300_000;
