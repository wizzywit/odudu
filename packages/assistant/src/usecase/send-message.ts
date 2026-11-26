import { toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { conversationRepository } from '#/repository/conversations';
import { messageRepository } from '#/repository/messages';
import { visibleMessages } from '#/usecase/conversation-view';
import { HISTORY_MESSAGES } from '#/service/context';
import { pageContextText, readPageContext } from '#/service/page-context';
import { runKey } from '#/service/run-key';
import { profileById } from '#/service/profile';
import type { TurnRegistry } from '#/service/turn-registry';
import { DEFAULT_TURN_DEADLINE_MS, type ChatCaller, type ChatDeps } from '#/usecase/chat-deps';
import { startTurn } from '#/usecase/run-turn';
import { readSettings } from '#/usecase/settings';

export type SendOutcome =
  | {
      kind: 'stream';
      stream: ReadableStream<UIMessageChunk>;
      /** Ends the turn: the model call is aborted and what was said so far is kept. */
      cancel: () => void;
    }
  | { kind: 'not_found' }
  | { kind: 'busy' }
  | { kind: 'saturated' };

interface Prepared {
  readonly profileId: string;
  readonly earlier: UIMessage[];
  readonly pageContext: string;
  readonly generation: number;
  readonly maskEmails: boolean;
}

async function prepare(deps: ChatDeps, caller: ChatCaller, id: string): Promise<Prepared | null> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return null;
    const messages = messageRepository(tx);
    const head = await messages.first(id);
    return {
      profileId: record.profile,
      generation: record.runGeneration,
      earlier: visibleMessages(id, await messages.load(id, HISTORY_MESSAGES)),
      pageContext: pageContextText(readPageContext(head?.parts)),
      maskEmails: (await readSettings(tx, caller.tenantId)).assistant_mask_emails,
    };
  });
}

// Reads the turn's stream through, and ends the turn if the stream fails or
// is dropped without the SDK reporting its end. A cancel aborts the model
// call; the turn then ends when its last message is stored.
function guarded(
  source: ReadableStream<UIMessageChunk>,
  abort: () => void,
  end: () => void,
): ReadableStream<UIMessageChunk> {
  const reader = source.getReader();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        end();
        controller.error(error);
      }
    },
    async cancel(reason) {
      abort();
      await reader.cancel(reason);
    },
  });
}

// Moves the conversation to its next run in a short transaction of its own, and
// names the instance that run acts as.
async function advance(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
  observed: number,
): Promise<number> {
  const next = await deps.transact(caller.tenantId, (tx) =>
    conversationRepository(tx).advanceRun(id, observed, (generation) =>
      deps.instanceIdFor(caller, id, runKey(id, generation)),
    ),
  );
  return next ?? observed;
}

/**
 * One turn: the person's message is stored before the model is called, each
 * step's result is stored as it ends and the last is stored when the turn
 * does, so a crash loses at most the step in flight. No transaction is held
 * while the model runs. `signal` is the request's own; the turn also ends when
 * `stop` is called for the conversation.
 */
export async function sendMessage(
  deps: ChatDeps,
  registry: TurnRegistry,
  caller: ChatCaller,
  id: string,
  message: UIMessage,
  signal: AbortSignal,
): Promise<SendOutcome> {
  const prepared = await prepare(deps, caller, id);
  const profile = prepared === null ? undefined : profileById(prepared.profileId);
  if (prepared === null || profile === undefined) return { kind: 'not_found' };

  const turn = new AbortController();
  const admitted = registry.begin(id, () => {
    turn.abort();
  });
  if (admitted.kind !== 'started') return { kind: admitted.kind };
  // A turn the provider has stalled still gives its place back.
  const deadline = setTimeout(() => {
    deps.log?.('assistant.turn_deadline', { conversation: id });
    turn.abort();
  }, deps.turnDeadlineMs ?? DEFAULT_TURN_DEADLINE_MS);
  const end = () => {
    clearTimeout(deadline);
    admitted.end();
  };

  try {
    await deps.transact(caller.tenantId, async (tx) => {
      await messageRepository(tx).append(id, { role: 'user', parts: message.parts });
      await conversationRepository(tx).touch(id, deps.now());
    });

    const { result, tools } = await startTurn(
      {
        model: deps.model(profile.slot),
        profile,
        tenantText: prepared.pageContext,
        maskEmails: prepared.maskEmails,
        tools: deps.tools,
        history: () => Promise.resolve(prepared.earlier),
        ...deps.turn(caller, id),
        advanceRun: (observed) => advance(deps, caller, id, observed),
      },
      { conversationId: id, generation: prepared.generation, message, signal: AbortSignal.any([signal, turn.signal]) },
    );

    let seq: number | undefined;
    let stored = '';
    // Stores run one after another, so a step never overtakes the one before.
    let stores: Promise<void> = Promise.resolve();
    const store = (parts: UIMessage['parts']): Promise<void> => {
      const text = JSON.stringify(parts);
      if (parts.length === 0 || text === stored) return stores;
      stores = stores.then(async () => {
        try {
          seq = await deps.transact(caller.tenantId, async (tx) => {
            const messages = messageRepository(tx);
            const written =
              seq === undefined
                ? await messages.append(id, { role: 'assistant', parts })
                : await messages.replaceLast(id, seq, { role: 'assistant', parts });
            await conversationRepository(tx).touch(id, deps.now());
            return written;
          });
          stored = text;
        } catch (error) {
          // What cannot be kept is not carried on with: the turn ends, and its
          // later steps are not stored over whatever is there now.
          deps.log?.('assistant.store_failed', {
            conversation: id,
            error: error instanceof Error ? error.name : 'unknown',
          });
          turn.abort();
          throw error;
        }
      });
      return stores;
    };

    const ui = toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: [...prepared.earlier, message],
      generateMessageId: deps.newId,
      onStepEnd: ({ responseMessage }) => store(responseMessage.parts),
      onEnd: async ({ responseMessage }) => {
        try {
          await store(responseMessage.parts);
        } finally {
          end();
        }
      },
    });
    return {
      kind: 'stream',
      stream: guarded(
        ui,
        () => {
          turn.abort();
        },
        end,
      ),
      cancel: () => {
        turn.abort();
      },
    };
  } catch (error) {
    end();
    throw error;
  }
}
