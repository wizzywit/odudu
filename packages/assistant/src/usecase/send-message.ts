import { toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { conversationRepository } from '#/repository/conversations';
import { MAX_LOAD, messageRepository } from '#/repository/messages';
import { visibleMessages } from '#/usecase/conversation-view';
import { pageContextText, readPageContext } from '#/service/page-context';
import { profileById } from '#/service/profile';
import type { TurnRegistry } from '#/service/turn-registry';
import type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';
import { startTurn } from '#/usecase/run-turn';

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
}

async function prepare(deps: ChatDeps, caller: ChatCaller, id: string): Promise<Prepared | null> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return null;
    const messages = messageRepository(tx);
    const head = await messages.first(id);
    return {
      profileId: record.profile,
      earlier: visibleMessages(id, await messages.load(id, MAX_LOAD)),
      pageContext: pageContextText(readPageContext(head?.parts)),
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
  const { end } = admitted;

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
        tools: deps.tools,
        history: () => Promise.resolve(prepared.earlier),
        ...deps.turn(caller),
      },
      { conversationId: id, message, signal: AbortSignal.any([signal, turn.signal]) },
    );

    let seq: number | undefined;
    // Stores run one after another, so a step never overtakes the one before.
    let stores: Promise<void> = Promise.resolve();
    const store = (parts: UIMessage['parts']): Promise<void> => {
      if (parts.length === 0) return stores;
      stores = stores.then(async () => {
        seq = await deps.transact(caller.tenantId, async (tx) => {
          const messages = messageRepository(tx);
          const written =
            seq === undefined
              ? await messages.append(id, { role: 'assistant', parts })
              : (await messages.replaceTail(id, seq, [{ role: 'assistant', parts }]))[0];
          await conversationRepository(tx).touch(id, deps.now());
          if (written === undefined) throw new Error('the assistant message was not stored');
          return written;
        });
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
