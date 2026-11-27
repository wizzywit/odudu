import { toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { approvalCardRepository } from '#/repository/approvals';
import { conversationRepository, type ConversationMode } from '#/repository/conversations';
import { toolsFor } from '#/service/tool-set';
import {
  actsInTenantOf,
  conversationIsCallers,
  crossTenant,
  settingsOfTwo,
  sideOf,
} from '#/service/conversation-access';
import { leaseRepository } from '#/repository/leases';
import { messageRepository } from '#/repository/messages';
import { visibleMessages } from '#/usecase/conversation-view';
import { HISTORY_MESSAGES } from '#/service/context';
import { leaseTtlMs, stopReasonOf, type AssistantLimits, type StopReason } from '#/service/limits';
import { titleOf } from '#/service/conversation-title';
import { pageContextText, readPageContext } from '#/service/page-context';
import { runKey } from '#/service/run-key';
import type { EndedReason } from '#/service/reattach-reason';
import { profileById } from '#/service/profile';
import { slotDecision } from '#/service/trace-decisions';
import { startOf, summaryOf } from '#/service/turn-summary';
import {
  approvalCardChunk,
  budgetWarningChunk,
  errorTextFor,
  turnEndChunk,
} from '#/service/stream-parts';
import type { TurnRegistry } from '#/service/turn-registry';
import { cardView, settleLastMessage, withdrawPending } from '#/usecase/approvals';
import { createTurnBudget } from '#/usecase/budget-hooks';
import {
  DEFAULT_TURN_DEADLINE_MS,
  type ApprovalPorts,
  type ChatCaller,
  type ChatDeps,
} from '#/usecase/chat-deps';
import { openEntitlements } from '#/usecase/entitlements';
import { attachConversation } from '#/usecase/reattach';
import { startTurn } from '#/usecase/run-turn';
import { readSettings } from '#/usecase/settings';
import type { TurnApprovals } from '#/usecase/tool-approval';
import { traceRecorder } from '#/usecase/trace-recorder';

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
  | { kind: 'limited'; retryAfterSeconds: number }
  // The conversation could not be given a grant under the sign-in the caller holds
  // now, for the reason named, so no turn could run in it.
  | { kind: 'ended'; reason: EndedReason }
  // A resume while a change still waits for the person, or with none to resume.
  | { kind: 'waiting' }
  | { kind: 'nothing_waiting' };

// How long a refused caller is told to wait before trying again.
export const LIMITED_RETRY_SECONDS = 5;

// The text a person typed in a message, its text parts joined.
function askedText(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

// How a turn starts: from the person's new message, or from the stored
// conversation after they decided a change.
type Start = { kind: 'message'; message: UIMessage } | { kind: 'resume' };

interface Head {
  readonly profileId: string;
  readonly generation: number;
  readonly pageContext: string;
  readonly maskEmails: boolean;
  readonly limits: AssistantLimits;
  readonly mode: ConversationMode;
  readonly titled: boolean;
}

// What a turn needs to know about the conversation before anything is changed:
// null for one that is not the caller's. Where the caller acts in another
// tenant, that tenant's settings are read in a transaction of its own and the
// stricter of the two applies; the limits stay the caller's tenant's, which pays.
async function readHead(deps: ChatDeps, caller: ChatCaller, id: string): Promise<Head | null> {
  const home = await deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record === undefined || !conversationIsCallers(record, caller)) return null;
    const head = await messageRepository(tx).first(id);
    const settings = await readSettings(tx, caller.tenantId);
    const limits = await (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId);
    return { record, head, settings, limits };
  });
  if (home === null) return null;
  const { record, head, limits } = home;
  const own = sideOf(home.settings, limits);
  const side = crossTenant(caller)
    ? settingsOfTwo(own, await targetSide(deps, actsInTenantOf(caller)))
    : own;
  if (!side.enabled) return null;
  return {
    profileId: record.profile,
    generation: record.runGeneration,
    pageContext: pageContextText(readPageContext(head?.parts)),
    maskEmails: side.maskEmails,
    limits,
    titled: record.title !== null,
    // Act only where the deployment can propose a change, every tenant involved
    // allows it, and the conversation is in the caller's own tenant.
    mode:
      record.mode === 'act' &&
      deps.approvals !== undefined &&
      side.modes.includes('act') &&
      !crossTenant(caller)
        ? 'act'
        : 'ask',
  };
}

async function targetSide(deps: ChatDeps, tenantId: string) {
  return deps.transact(tenantId, async (tx) => {
    const settings = await readSettings(tx, tenantId);
    return sideOf(settings, await (deps.entitlements ?? openEntitlements(tx)).limits(tenantId));
  });
}

interface Loaded {
  readonly earlier: UIMessage[];
  // The last message's number when it is the assistant's, which a resumed turn continues.
  readonly lastSeq: number | undefined;
  readonly lastParts: unknown[] | undefined;
}

async function loadMessages(deps: ChatDeps, caller: ChatCaller, id: string): Promise<Loaded> {
  return deps.transact(caller.tenantId, async (tx) => {
    const records = await messageRepository(tx).load(id, HISTORY_MESSAGES);
    const last = records[records.length - 1];
    return {
      earlier: visibleMessages(id, records),
      lastSeq: last?.role === 'assistant' ? last.seq : undefined,
      lastParts: last?.role === 'assistant' ? (last.parts as unknown[]) : undefined,
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

// What the server holds that must never reach the trace: the provider's keys it
// was given and the secret that signs approvals, in the forms they could be written.
function knownSecretsOf(deps: ChatDeps): string[] {
  const signing = deps.approvalSecret;
  const forms =
    signing === undefined
      ? []
      : [
          Buffer.from(signing).toString('base64'),
          Buffer.from(signing).toString('base64url'),
          Buffer.from(signing).toString('hex'),
        ];
  return [...(deps.knownSecrets ?? []), ...forms];
}

// A token minted for the turn is a secret the moment it exists.
function mintingKnown(
  turn: ReturnType<ChatDeps['turn']>,
  trace: { know: (secret: string) => void },
): ReturnType<ChatDeps['turn']> {
  return {
    ...turn,
    mintToken: async (run, signal) => {
      const minted = await turn.mintToken(run, signal);
      trace.know(minted.accessToken);
      return minted;
    },
  };
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
 * step's result as it ends and the last when the turn does, so a crash loses
 * at most the step in flight. No transaction is held while the model runs.
 * `signal` is the request's own; the turn also ends when `stop` is called.
 * The turn holds a lease in the database while it runs, so the tenant's limit
 * on answers at once counts every server, and each model call is reserved
 * against the budget first.
 */
export function sendMessage(
  deps: ChatDeps,
  registry: TurnRegistry,
  caller: ChatCaller,
  id: string,
  message: UIMessage,
  signal: AbortSignal,
): Promise<SendOutcome> {
  return runConversationTurn(deps, registry, caller, id, { kind: 'message', message }, signal);
}

/**
 * Carries a conversation on after the person decided a change: the stored
 * messages end with the answer that asked, the decision is applied to it, and
 * the model is called again, which runs a change that was approved and lets the
 * model read the refusal of one that was not. Nothing is added by the person.
 */
export function resumeTurn(
  deps: ChatDeps,
  registry: TurnRegistry,
  caller: ChatCaller,
  id: string,
  signal: AbortSignal,
): Promise<SendOutcome> {
  return runConversationTurn(deps, registry, caller, id, { kind: 'resume' }, signal);
}

// Where the turn's changes go: the deployment's approval ports, with the cards
// this conversation stores and the card chunk the person is sent.
function turnApprovals(
  ports: ApprovalPorts,
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
  turnId: string,
  proposed: TurnApprovals['proposed'],
): TurnApprovals {
  return {
    proposed,
    open: async (call) => {
      const outcome = await ports.open(
        caller,
        {
          conversationId: id,
          tool: call.tool,
          input: call.input,
          summary: call.body.title,
          now: deps.now(),
        },
        async (tx, opened) => {
          await approvalCardRepository(tx).create({
            approvalId: opened.approvalId,
            conversationId: id,
            toolCallId: call.toolCallId,
            tool: call.tool,
            body: call.body,
          });
          return opened;
        },
      );
      if (outcome.kind === 'refused') return outcome;
      return {
        kind: 'opened',
        card: cardView({
          approvalId: outcome.value.approvalId,
          conversationId: id,
          toolCallId: call.toolCallId,
          tool: call.tool,
          body: call.body,
          state: 'pending',
          expiresAt: outcome.value.expiresAt,
        }),
      };
    },
    write: (tool, input, context) =>
      ports.write(
        caller,
        {
          conversationId: id,
          turnId,
          toolCallId: context.toolCallId,
          tool,
          input,
          now: deps.now(),
          signal: context.signal,
        },
        async (tx) => {
          // Only an Act conversation of the caller runs a change, and only the
          // one the card was stored for.
          const record = await conversationRepository(tx).byId(id);
          if (
            record === undefined ||
            !conversationIsCallers(record, caller) ||
            record.mode !== 'act'
          ) {
            return undefined;
          }
          const card = await approvalCardRepository(tx).byCall(id, context.toolCallId);
          return card?.tool === tool ? card.approvalId : undefined;
        },
      ),
  };
}

async function runConversationTurn(
  deps: ChatDeps,
  registry: TurnRegistry,
  caller: ChatCaller,
  id: string,
  start: Start,
  signal: AbortSignal,
): Promise<SendOutcome> {
  const head = await readHead(deps, caller, id);
  const profile = head === null ? undefined : profileById(head.profileId);
  if (head === null || profile === undefined) return { kind: 'not_found' };
  const prepared: Head = head;
  // The run and sign-in facts the conversation has once it is admitted and, if
  // need be, carried on under this sign-in.
  let generation = head.generation;
  let carriedOn = false;

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
  const trace = traceRecorder({
    transact: (fn) => deps.transact(caller.tenantId, fn),
    now: deps.now,
    newId: deps.newId,
    tenantId: caller.tenantId,
    turnId,
    conversationId: id,
    profile: profile.id,
    slot: profile.slot,
    maskEmails: prepared.maskEmails,
    known: knownSecretsOf(deps),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
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
    onReservation: (decision) => {
      trace.decision(turnId, 'reservation', decision);
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
  // A change was stored for the person and the turn is ending on it.
  let awaitingApproval = false;
  // The row that opens the turn was written, so one that closes it is owed.
  let opened = false;
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
    ...(crossTenant(caller) ? { targetTenantId: actsInTenantOf(caller) } : {}),
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
      awaitingApproval,
    });
  const facts = {
    tenantId: caller.tenantId,
    subjectId: caller.ownerSubjectId,
    conversationId: id,
    turnId,
    profile: profile.id,
    mode: prepared.mode,
    slot: profile.slot,
    ...(crossTenant(caller) ? { targetTenantId: actsInTenantOf(caller) } : {}),
  };
  // The closing row is written once the turn has settled; a failure of it is
  // logged and never changes what the person saw.
  const closeTurnRow = async (): Promise<void> => {
    try {
      // The trace closes first, in its own transaction, so that the row says
      // whether the trace is whole. The two cannot be one transaction: the
      // audit row is the server's, written through its own repository.
      const stopReason = ending();
      await trace.end(stopReason);
      const summary = summaryOf({
        ...facts,
        steps: progress().steps,
        tokens: budget.charged(),
        stopReason,
        traceLost: trace.lost(),
      });
      await deps.recordTurn(summary);
    } catch (error) {
      deps.log?.('assistant.turn_audit_failed', {
        conversation: id,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
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
      if (opened) await closeTurnRow();
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
    // Only an admitted turn carries a conversation on: a send that is refused as
    // busy or limited never replaces the grant a running turn acts under. A
    // grant that ended with an earlier sign-in is replaced before anything is stored.
    const attached = await attachConversation(deps, caller, id);
    if (attached.kind !== 'ready') {
      await conclude();
      return attached.kind === 'ended'
        ? { kind: 'ended', reason: attached.reason }
        : { kind: 'not_found' };
    }
    generation = attached.generation;
    carriedOn = attached.carriedOn;
    // What was asked of the person is settled before the model reads the
    // conversation: a change they moved on from is withdrawn, one they decided
    // is closed or handed back, and a resume with nothing to carry on from says so.
    if (deps.approvals !== undefined) {
      if (start.kind === 'message') await withdrawPending(deps, caller, id, 'superseded');
      const settlement = await settleLastMessage(deps, caller, id, start.kind);
      if (start.kind === 'resume' && settlement.waiting > 0) {
        await conclude();
        return { kind: 'waiting' };
      }
      if (start.kind === 'resume' && settlement.resumable + settlement.settled === 0) {
        await conclude();
        return { kind: 'nothing_waiting' };
      }
    } else if (start.kind === 'resume') {
      await conclude();
      return { kind: 'nothing_waiting' };
    }
    // The turn does not begin unless its opening row is written: nothing has
    // been stored, reserved or sent to a model yet.
    await deps.recordTurnStart(startOf(facts));
    opened = true;
    const model = deps.model(profile.slot);
    trace.decision(turnId, 'slot_chosen', slotDecision(profile.slot, profile.id, model));
    const loaded = await loadMessages(deps, caller, id);
    if (start.kind === 'message') {
      const { message } = start;
      await deps.transact(caller.tenantId, async (tx) => {
        await messageRepository(tx).append(id, { role: 'user', parts: message.parts });
        await conversationRepository(tx).touch(id, deps.now());
        const title = prepared.titled ? null : titleOf(askedText(message));
        if (title !== null) await conversationRepository(tx).setTitleOnce(id, title);
      });
    }
    const earlier = loaded.earlier;
    const original = start.kind === 'message' ? [...earlier, start.message] : earlier;

    const started = await startTurn(
      {
        model,
        profile,
        tenantText: prepared.pageContext,
        maskEmails: prepared.maskEmails,
        tools: toolsFor(deps.tools, caller),
        mode: prepared.mode,
        earlierSignIn: carriedOn,
        ...(deps.approvalSecret === undefined ? {} : { approvalSecret: deps.approvalSecret }),
        ...(deps.log === undefined ? {} : { log: deps.log }),
        ...(deps.approvals === undefined
          ? {}
          : {
              approvals: turnApprovals(deps.approvals, deps, caller, id, turnId, (card) => {
                awaitingApproval = true;
                raised.push(approvalCardChunk(card));
              }),
            }),
        budget,
        trace: {
          integrations: [trace, ...(deps.telemetry ?? [])],
          begin: (promptHash) => trace.begin(promptHash),
          onDecision: (kind, payload) => {
            trace.decision(turnId, kind, payload);
          },
        },
        maxStepsPerTurn: prepared.limits.maxStepsPerTurn,
        history: () => Promise.resolve(earlier),
        ...mintingKnown(deps.turn(caller, id, turnId), trace),
        advanceRun: (observed) => advance(deps, caller, id, observed),
      },
      {
        conversationId: id,
        generation,
        ...(start.kind === 'message' ? { message: start.message } : {}),
        signal: AbortSignal.any([signal, turn.signal]),
      },
    );
    progress = started.progress;
    maxSteps = started.maxSteps;

    // A resumed turn carries on the answer that asked, so its first store
    // rewrites that message and the ones after it follow.
    let seq: number | undefined = start.kind === 'resume' ? loaded.lastSeq : undefined;
    // What the stored message holds as far as this turn knows, which its next write must find.
    let known: unknown[] | undefined = start.kind === 'resume' ? loaded.lastParts : undefined;
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
                : await messages.replaceLast(id, seq, { role: 'assistant', parts }, known);
            await conversationRepository(tx).touch(id, deps.now());
            return written;
          });
          stored = text;
          known = parts;
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
      originalMessages: original,
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
