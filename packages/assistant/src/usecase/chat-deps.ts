import type { RegisteredTool } from '@odudu/mcp';
import type { LanguageModel } from 'ai';
import type { AssistantTx } from '#/repository/tx';
import type { RunTurnDeps } from '#/usecase/run-turn';
import type { Entitlements } from '#/service/entitlements';
import type { LevelName, StopReason } from '#/service/limits';
import type { Slot } from '#/service/slots';

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

export interface ChatDeps {
  /** Runs `fn` in one short transaction bound to the tenant. */
  readonly transact: <T>(tenantId: string, fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly model: (slot: Slot) => LanguageModel;
  readonly tools: readonly RegisteredTool[];
  /** How a turn for this caller gets a token and runs a tool. */
  readonly turn: (caller: ChatCaller) => Pick<RunTurnDeps, 'mintToken' | 'callTool'>;
  /** The agent instance a new conversation acts as. */
  readonly instanceIdFor: (caller: ChatCaller, conversationId: string) => string;
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
