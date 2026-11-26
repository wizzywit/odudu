import type {
  AssistantConversation,
  CreateConversationRequest,
  SendMessageRequest,
} from '@odudu/contracts/admin';
import { createUIMessageStreamResponse } from 'ai';
import { createTurnRegistry } from '#/service/turn-registry';
import { DEFAULT_MAX_RUNNING, type ChatCaller, type ChatDeps } from '#/usecase/chat-deps';
import { createConversation, loadConversation, type CreateOutcome } from '#/usecase/conversations';
import { sendMessage } from '#/usecase/send-message';
import { stopTurn } from '#/usecase/stop-turn';

export type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';
export type { CreateOutcome } from '#/usecase/conversations';

export type SendResult =
  | { kind: 'stream'; response: Response }
  | { kind: 'not_found' }
  | { kind: 'busy' }
  | { kind: 'saturated' }
  | { kind: 'limited'; retryAfterSeconds: number };

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
}

export function createChat(deps: ChatDeps): Chat {
  const registry = createTurnRegistry(deps.maxRunning ?? DEFAULT_MAX_RUNNING);
  return {
    create: (caller, body) => createConversation(deps, caller, body),
    load: (caller, id) => loadConversation(deps, caller, id),

    async send(caller, id, message, signal) {
      const outcome = await sendMessage(deps, registry, caller, id, message, signal);
      if (outcome.kind !== 'stream') return outcome;
      return {
        kind: 'stream',
        response: createUIMessageStreamResponse({
          stream: outcome.stream,
          headers: { 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
        }),
      };
    },

    stop: (caller, id) => stopTurn(deps, registry, caller, id),
  };
}
