import type {
  AssistantApprovalCard,
  AssistantConversation,
  AssistantMode,
  CreateConversationRequest,
  SendMessageRequest,
} from '@odudu/contracts/admin';
import { createUIMessageStreamResponse } from 'ai';
import { createTurnRegistry } from '#/service/turn-registry';
import { decideCard, listApprovals, setConversationMode } from '#/usecase/approvals';
import type { SetModeOutcome } from '#/usecase/approvals';
import {
  DEFAULT_MAX_RUNNING,
  type ChatCaller,
  type ChatDeps,
  type DecideResult,
} from '#/usecase/chat-deps';
import { createConversation, loadConversation, type CreateOutcome } from '#/usecase/conversations';
import { resumeTurn, sendMessage, type SendOutcome } from '#/usecase/send-message';
import { stopTurn } from '#/usecase/stop-turn';

export type { ChatCaller, ChatDeps, DecideResult } from '#/usecase/chat-deps';
export type { CreateOutcome } from '#/usecase/conversations';
export type { SetModeOutcome } from '#/usecase/approvals';

export type SendResult =
  | { kind: 'stream'; response: Response }
  | { kind: 'not_found' }
  | { kind: 'busy' }
  | { kind: 'saturated' }
  | { kind: 'limited'; retryAfterSeconds: number };

/** A resume adds two answers: a change still waits, or nothing does. */
export type ResumeResult = SendResult | { kind: 'waiting' } | { kind: 'nothing_waiting' };

/**
 * The assistant's chat as a framework-neutral port: each call takes a caller
 * the admin API's door has already authenticated and returns a value or a web
 * `Response`, so the package imports no web framework. A conversation is
 * reached only by its owner; any other caller is told it does not exist.
 */
export interface Chat {
  create(caller: ChatCaller, body: CreateConversationRequest): Promise<CreateOutcome>;
  load(caller: ChatCaller, id: string): Promise<AssistantConversation | null>;
  /** Streams the turn as UI message chunks (server-sent events). */
  send(
    caller: ChatCaller,
    id: string,
    message: SendMessageRequest['message'],
    signal: AbortSignal,
  ): Promise<SendResult>;
  /** Ends the conversation's running turn, if this process runs it. */
  stop(caller: ChatCaller, id: string): Promise<'stopped' | 'idle' | 'not_found'>;
  /** The conversation's changes still waiting for the person, or null for one that is not theirs. */
  approvals(caller: ChatCaller, id: string): Promise<AssistantApprovalCard[] | null>;
  /** The person's decision on one change, recorded as the approval's owner. */
  answerApproval(
    caller: ChatCaller,
    id: string,
    approvalId: string,
    approve: boolean,
  ): Promise<DecideResult>;
  /** Carries the conversation on after a decision, streaming like a message does. */
  resume(caller: ChatCaller, id: string, signal: AbortSignal): Promise<ResumeResult>;
  /** Switches the conversation between Ask and Act. */
  setMode(caller: ChatCaller, id: string, mode: AssistantMode): Promise<SetModeOutcome>;
}

function streamed(outcome: SendOutcome): ResumeResult {
  if (outcome.kind !== 'stream') return outcome;
  return {
    kind: 'stream',
    response: createUIMessageStreamResponse({
      stream: outcome.stream,
      headers: { 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    }),
  };
}

export function createChat(deps: ChatDeps): Chat {
  // The type forbids it; a caller that got round the type is stopped here.
  if (
    deps.approvals !== undefined &&
    (deps.approvalSecret as Uint8Array | undefined)?.length === undefined
  ) {
    throw new Error('approvals need an approval secret to sign their requests');
  }
  const registry = createTurnRegistry(deps.maxRunning ?? DEFAULT_MAX_RUNNING);
  return {
    create: (caller, body) => createConversation(deps, caller, body),
    load: (caller, id) => loadConversation(deps, caller, id),

    async send(caller, id, message, signal) {
      const outcome = streamed(await sendMessage(deps, registry, caller, id, message, signal));
      // A message never waits on a change: it withdraws one.
      return outcome.kind === 'waiting' || outcome.kind === 'nothing_waiting'
        ? { kind: 'not_found' }
        : outcome;
    },

    stop: (caller, id) => stopTurn(deps, registry, caller, id),

    approvals: (caller, id) => listApprovals(deps, caller, id),

    answerApproval: (caller, id, approvalId, approve) =>
      decideCard(deps, caller, id, approvalId, approve),

    async resume(caller, id, signal) {
      return streamed(await resumeTurn(deps, registry, caller, id, signal));
    },

    setMode: (caller, id, mode) => setConversationMode(deps, caller, id, mode),
  };
}
