import type { RegisteredTool } from '@odudu/mcp';
import type { LanguageModel } from 'ai';
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

export interface ChatDeps {
  /** Runs `fn` in one short transaction bound to the tenant. */
  readonly transact: <T>(tenantId: string, fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly model: (slot: Slot) => LanguageModel;
  readonly tools: readonly RegisteredTool[];
  /** How a turn for this caller gets a token and runs a tool. */
  readonly turn: (caller: ChatCaller) => Pick<RunTurnDeps, 'mintToken' | 'callTool'>;
  /** The agent instance a new conversation acts as. */
  readonly instanceIdFor: (caller: ChatCaller, conversationId: string) => string;
  readonly now: () => Date;
  readonly newId: () => string;
  /** The most turns this process runs at once; 256 unless a test says otherwise. */
  readonly maxRunning?: number;
}

export const DEFAULT_MAX_RUNNING = 256;
