import type { RegisteredTool } from '@odudu/mcp';
import type { LanguageModel } from 'ai';
import type { ConversationMode } from '#/repository/conversations';
import type { AssistantTx } from '#/repository/tx';
import type { RunTurnDeps } from '#/usecase/run-turn';
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

export type AccessOutcome<T> = { kind: 'granted'; value: T } | { kind: 'refused'; reason: string };

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
