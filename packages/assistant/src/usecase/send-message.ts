import { toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { conversationRepository } from '#/repository/conversations';
import { leaseRepository } from '#/repository/leases';
import { messageRepository } from '#/repository/messages';
import { visibleMessages } from '#/usecase/conversation-view';
import { HISTORY_MESSAGES } from '#/service/context';
import { leaseTtlMs, stopReasonOf, type AssistantLimits, type StopReason } from '#/service/limits';
import { pageContextText, readPageContext } from '#/service/page-context';
import { profileById } from '#/service/profile';
import { budgetWarningChunk, errorTextFor, turnEndChunk } from '#/service/stream-parts';
import type { TurnRegistry } from '#/service/turn-registry';
import { createTurnBudget } from '#/usecase/budget-hooks';
import { DEFAULT_TURN_DEADLINE_MS, type ChatCaller, type ChatDeps } from '#/usecase/chat-deps';
import { openEntitlements } from '#/usecase/entitlements';
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
  | { kind: 'saturated' }
  | { kind: 'limited'; retryAfterSeconds: number };

// How long a refused caller is told to wait before trying again.
export const LIMITED_RETRY_SECONDS = 5;

interface Prepared {
  readonly profileId: string;
  readonly earlier: UIMessage[];
  readonly pageContext: string;
  readonly maskEmails: boolean;
  readonly limits: AssistantLimits;
}

async function prepare(deps: ChatDeps, caller: ChatCaller, id: string): Promise<Prepared | null> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return null;
    const messages = messageRepository(tx);
    const head = await messages.first(id);
    const settings = await readSettings(tx, caller.tenantId);
    return {
      profileId: record.profile,
      earlier: visibleMessages(id, await messages.load(id, HISTORY_MESSAGES)),
      pageContext: pageContextText(readPageContext(head?.parts)),
      maskEmails: settings.assistant_mask_emails,
      limits: await (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId),
    };
  });
}

// Reads the turn's stream through. The chunks the budget raised (a warning)
// are sent ahead of the next one, and the turn's last chunk names why it
// ended. A failure or a dropped stream concludes the turn too.
function guarded(
  source: ReadableStream<UIMessageChunk>,
  abort: () => void,
  conclude: () => Promise<void>,
  raised: () => UIMessageChunk[],
  ending: () => StopReason,
): ReadableStream<UIMessageChunk> {
  const reader = source.getReader();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const next = await reader.read();
        for (const chunk of raised()) controller.enqueue(chunk);
        if (next.done) {
          await conclude();
          controller.enqueue(turnEndChunk(ending()));
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        await conclude();
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
 * step's result as it ends and the last when the turn does, so a crash loses
 * at most the step in flight. No transaction is held while the model runs.
 * `signal` is the request's own; the turn also ends when `stop` is called.
 * The turn holds a lease in the database while it runs, so the tenant's limit
 * on answers at once counts every server, and each model call is reserved
 * against the budget first.
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

  const turnId = deps.newId();
  const deadlineMs = deps.turnDeadlineMs ?? DEFAULT_TURN_DEADLINE_MS;
  const leased = await deps
    .transact(caller.tenantId, (tx) =>
      leaseRepository(tx).acquire({
        turnId,
        conversationId: id,
        max: prepared.limits.maxConcurrent,
        now: deps.now(),
        ttlMs: leaseTtlMs(deadlineMs),
      }),
    )
    .catch((error: unknown) => {
      admitted.end();
      throw error;
    });
  if (!leased.ok) {
    admitted.end();
    return { kind: 'limited', retryAfterSeconds: LIMITED_RETRY_SECONDS };
  }

  const raised: UIMessageChunk[] = [];
  const overruns: number[] = [];
  const budget = createTurnBudget({
    transact: (fn) => deps.transact(caller.tenantId, fn),
    now: deps.now,
    limits: prepared.limits,
    tenantId: caller.tenantId,
    ownerSubjectId: caller.ownerSubjectId,
    conversationId: id,
    turnId,
    slot: profile.slot,
    onWarning: (warning) => {
      raised.push(budgetWarningChunk(warning));
    },
    onOverrun: (tokens) => {
      overruns.push(tokens);
    },
  });

  // A turn the provider has stalled still gives its place back.
  const deadline = setTimeout(() => {
    deps.log?.('assistant.turn_deadline', { conversation: id });
    turn.abort();
  }, deadlineMs);

  let outcomeStatus: 'completed' | 'failed' | 'aborted' | 'unknown' = 'unknown';
  let concluding: Promise<void> | undefined;
  let progress = () => ({ steps: 0, lastFinish: undefined as string | undefined });
  let maxSteps = profile.maxSteps;
  const audit = async (event: Parameters<NonNullable<ChatDeps['audit']>>[0]): Promise<void> => {
    try {
      await deps.audit?.(event);
    } catch (error) {
      deps.log?.('assistant.budget_audit_failed', {
        conversation: id,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
  const event = (extra: { outcome: 'refused' | 'allowed' } & Record<string, unknown>) => ({
    tenantId: caller.tenantId,
    subjectId: caller.ownerSubjectId,
    conversationId: id,
    turnId,
    slot: profile.slot,
    ...extra,
  });
  const ending = (): StopReason =>
    stopReasonOf({
      refused: budget.refused(),
      aborted: outcomeStatus === 'aborted' || turn.signal.aborted || signal.aborted,
      failed: outcomeStatus === 'failed',
      steps: progress().steps,
      maxSteps,
      lastFinish: progress().lastFinish,
    });
  // Settles what the turn still holds and gives its place back, once, whichever
  // way it ends; the audit rows follow, and a failure of one never changes
  // what the person saw.
  const conclude = (): Promise<void> => {
    concluding ??= (async () => {
      clearTimeout(deadline);
      try {
        await budget.finish();
      } catch (error) {
        deps.log?.('assistant.budget_settle_failed', {
          conversation: id,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      try {
        await deps.transact(caller.tenantId, (tx) => leaseRepository(tx).release(turnId));
      } catch (error) {
        deps.log?.('assistant.lease_release_failed', {
          conversation: id,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      admitted.end();
      const refusal = budget.refused();
      if (refusal !== undefined) {
        await audit(
          event({ outcome: 'refused', level: refusal.level, stopReason: refusal.stopReason }),
        );
      }
      for (const tokens of overruns) {
        await audit(event({ outcome: 'allowed', overrunTokens: tokens }));
      }
    })();
    return concluding;
  };

  try {
    await deps.transact(caller.tenantId, async (tx) => {
      await messageRepository(tx).append(id, { role: 'user', parts: message.parts });
      await conversationRepository(tx).touch(id, deps.now());
    });

    const started = await startTurn(
      {
        model: deps.model(profile.slot),
        profile,
        tenantText: prepared.pageContext,
        maskEmails: prepared.maskEmails,
        tools: deps.tools,
        budget,
        maxStepsPerTurn: prepared.limits.maxStepsPerTurn,
        history: () => Promise.resolve(prepared.earlier),
        ...deps.turn(caller),
      },
      { conversationId: id, message, signal: AbortSignal.any([signal, turn.signal]) },
    );
    progress = started.progress;
    maxSteps = started.maxSteps;

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
      stream: started.result.stream,
      tools: started.tools,
      originalMessages: [...prepared.earlier, message],
      generateMessageId: deps.newId,
      onError: () => errorTextFor(budget.refused(), profile.slot),
      onStepEnd: ({ responseMessage }) => store(responseMessage.parts),
      onEnd: async ({ responseMessage, outcome }) => {
        outcomeStatus = outcome.status;
        try {
          await store(responseMessage.parts);
        } finally {
          await conclude();
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
        conclude,
        () => raised.splice(0),
        ending,
      ),
      cancel: () => {
        turn.abort();
      },
    };
  } catch (error) {
    await conclude();
    throw error;
  }
}
