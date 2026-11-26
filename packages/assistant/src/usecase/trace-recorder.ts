import { AsyncLocalStorage } from 'node:async_hooks';
import type { Telemetry } from 'ai';
import { traceRepository, type EventKind, type NewEvent } from '#/repository/trace';
import type { AssistantTx } from '#/repository/tx';
import { cleanJson, cleanText } from '#/service/clean-text';
import { cutText } from '#/service/cut';
import type { StopReason } from '#/service/limits';
import { createMasker } from '#/service/mask-secrets';
import type { Slot } from '#/service/slots';
import { createLedger } from '#/service/trace-ledger';
import { boundPayload, errorPayload, payloadBytes, toJson } from '#/service/trace-payload';

/** The choices around a model call that the SDK cannot see, recorded by the code that makes them. */
export type DecisionKind = 'slot_chosen' | 'reservation' | 'narrowing' | 'policy' | 'trimming';

/** Records a choice the turn made around a model call. */
export type OnDecision = (kind: DecisionKind, payload: Readonly<Record<string, unknown>>) => void;

export interface TraceDeps {
  readonly transact: <T>(fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly conversationId: string;
  readonly profile: string;
  readonly slot: Slot;
  /** The tenant's `assistant_mask_emails`: the trace holds no address the model was not shown. */
  readonly maskEmails: boolean;
  readonly log?: (event: string, detail: Record<string, unknown>) => void;
  /** The longest one trace transaction may take before the trace is given up; 2,000 ms. */
  readonly deadlineMs?: number;
  /** Secrets the server holds, masked wherever they turn up. */
  readonly known?: readonly string[];
  /** How long a closing attempt waits before its one retry after a timeout; 300 ms. */
  readonly retryMs?: number;
}

/**
 * What one turn leaves in the trace. The SDK calls its hooks as the model and
 * the tools work; `decision` takes what the turn's own code chose. Every write
 * is a short transaction of its own, made at a step's start and end and never
 * held across a model call. A write that fails is logged and the trace stops
 * there: the turn goes on, and `lost()` says the record is incomplete.
 */
export interface TraceRecorder extends Telemetry {
  /** Opens the turn's row; `promptHash` stands for the system prompt, which is not stored. */
  begin(promptHash: string): Promise<void>;
  decision(turnId: string, kind: DecisionKind, payload: Readonly<Record<string, unknown>>): void;
  /** Closes the steps still open and the turn, and writes what was held. Once. */
  end(stopReason: StopReason): Promise<void>;
  /** A secret the server came to hold during the turn, such as a token it minted. */
  know(secret: string): void;
  /** A write failed, so the trace of this turn is incomplete. */
  lost(): boolean;
}

const MODEL_LENGTH = 200;
const REQUEST_ID_LENGTH = 256;
export const TRACE_DEADLINE_MS = 2_000;
const RETRY_MS = 300;

const orNull = (value: number | undefined): number | null => value ?? null;

class TraceTimeout extends Error {
  constructor() {
    super('a trace write took too long');
    this.name = 'TraceTimeout';
  }
}

export function traceRecorder(deps: TraceDeps): TraceRecorder {
  const masker = createMasker({
    emails: deps.maskEmails,
    ...(deps.known === undefined ? {} : { known: deps.known }),
  });
  const ledger = createLedger();
  // A tool that runs another agent has its steps recorded under the step that called it.
  const nesting = new AsyncLocalStorage<{ readonly stepId: string }>();
  const stepOf = new Map<string, string>();
  const open = new Set<string>();
  let pending: NewEvent[] = [];
  let failed = false;
  let begun = false;
  let ended = false;
  let queue: Promise<void> = Promise.resolve();

  const fail = (error: unknown): void => {
    failed = true;
    pending = [];
    deps.log?.('assistant.trace_failed', {
      conversation: deps.conversationId,
      turn: deps.turnId,
      error: error instanceof Error ? error.name : 'unknown',
    });
  };

  // Made storable, then masked, then bounded: a secret cut in half no longer
  // matches a shape. What the server wrote itself (`own`) is masked by structure
  // only, so nothing a tool returned can rewrite it.
  const add = (kind: EventKind, payload: unknown, stepId: string | null, own = false): void => {
    if (failed) return;
    try {
      const clean = cleanJson(toJson(payload));
      const kept = boundPayload(own ? masker.maskRecord(clean) : masker.mask(clean));
      const seq = ledger.admit(payloadBytes(kept));
      if (seq !== undefined) pending.push({ seq, stepId, kind, payload: kept, at: deps.now() });
    } catch (error) {
      fail(error);
    }
  };

  // The SDK waits for the trace's writes, so one that hangs would stall the turn.
  const within = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TraceTimeout());
      }, deps.deadlineMs ?? TRACE_DEADLINE_MS);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  };

  // Queues one transaction: `work`, then every event held so far. Transactions
  // run one after another, so an event never reaches the table before the step
  // or the turn it names.
  const commit = (
    work: (repo: ReturnType<typeof traceRepository>) => Promise<void>,
  ): Promise<void> => {
    queue = queue.then(async () => {
      if (failed) return;
      const batch = pending;
      pending = [];
      try {
        await within(
          deps.transact(async (tx) => {
            const repo = traceRepository(tx);
            await work(repo);
            await repo.appendEvents(deps.tenantId, deps.turnId, batch);
          }),
        );
      } catch (error) {
        fail(error);
      }
    });
    return queue;
  };

  const safely = (work: () => void): void => {
    try {
      work();
    } catch (error) {
      fail(error);
    }
  };

  const hooks: Telemetry = {
    onStepStart: (event) => {
      const id = deps.newId();
      const startedAt = deps.now();
      stepOf.set(event.callId, id);
      open.add(id);
      return commit((repo) =>
        repo.openStep({
          tenantId: deps.tenantId,
          turnId: deps.turnId,
          id,
          parentStepId: nesting.getStore()?.stepId ?? null,
          slot: deps.slot,
          model: cutText(cleanText(`${event.provider}/${event.modelId}`), MODEL_LENGTH),
          startedAt,
        }),
      );
    },

    onLanguageModelCallEnd: (event) => {
      safely(() => {
        const stepId = stepOf.get(event.callId) ?? null;
        add(
          'model_call',
          {
            model: event.modelId,
            finish_reason: event.finishReason,
            input_tokens: event.usage.inputTokens ?? null,
            output_tokens: event.usage.outputTokens ?? null,
            response_ms: event.performance.responseTimeMs,
          },
          stepId,
        );
        const text = event.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('');
        if (text !== '') add('text', { text }, stepId);
      });
    },

    onToolExecutionStart: (event) => {
      safely(() => {
        const call: { toolName: string; toolCallId: string; input: unknown } = event.toolCall;
        add(
          'tool_call',
          { tool: call.toolName, tool_call_id: call.toolCallId, input: call.input },
          stepOf.get(event.callId) ?? null,
        );
      });
    },

    onToolExecutionEnd: (event) => {
      safely(() => {
        const { toolOutput } = event;
        const base = {
          tool: toolOutput.toolName,
          tool_call_id: toolOutput.toolCallId,
          ms: event.toolExecutionMs,
        };
        const stepId = stepOf.get(event.callId) ?? null;
        if (toolOutput.type === 'tool-error') {
          add('tool_error', { ...base, error: errorPayload(toolOutput.error) }, stepId);
        } else {
          const output: unknown = toolOutput.output;
          add('tool_result', { ...base, output }, stepId);
        }
      });
    },

    onStepEnd: (step) => {
      const id = stepOf.get(step.callId);
      if (id === undefined) return undefined;
      // Left open until its close is written, so the turn's end can try again.
      return commit(async (repo) => {
        await repo.closeStep({
          tenantId: deps.tenantId,
          id,
          providerRequestId:
            step.response.id === ''
              ? null
              : cutText(cleanText(step.response.id), REQUEST_ID_LENGTH),
          inputTokens: orNull(step.usage.inputTokens),
          outputTokens: orNull(step.usage.outputTokens),
          endedAt: deps.now(),
        });
        open.delete(id);
      });
    },

    onError: (error) => {
      safely(() => {
        add('error', errorPayload(error), null);
      });
    },

    onAbort: () => {
      safely(() => {
        add('error', { name: 'AbortError', aborted: true }, null);
      });
    },

    executeTool: ({ callId, execute }) => {
      const stepId = stepOf.get(callId);
      return stepId === undefined ? execute() : nesting.run({ stepId }, execute);
    },
  };

  return {
    ...hooks,

    async begin(promptHash) {
      const startedAt = deps.now();
      await commit(async (repo) => {
        await repo.openTurn({
          tenantId: deps.tenantId,
          id: deps.turnId,
          conversationId: deps.conversationId,
          profile: deps.profile,
          promptHash,
          startedAt,
        });
        begun = true;
      });
    },

    decision(turnId, kind, payload) {
      if (turnId !== deps.turnId) return;
      safely(() => {
        add(kind, payload, null, true);
      });
    },

    async end(stopReason) {
      if (ended) return queue;
      ended = true;
      if (!begun) return queue;
      const endedAt = deps.now();
      const unfinished = [...open];
      open.clear();
      // Closes what is open; false when a row is not there to close, which is what
      // a write that timed out and commits late looks like.
      const close = async (repo: ReturnType<typeof traceRepository>): Promise<boolean> => {
        let whole = true;
        for (const id of unfinished) {
          const closed = await repo.closeStep({
            tenantId: deps.tenantId,
            id,
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            endedAt,
          });
          whole &&= closed;
        }
        return (await repo.closeTurn(deps.tenantId, deps.turnId, endedAt, stopReason)) && whole;
      };
      if (failed) {
        // A write that timed out may still commit, after this: one retry once it
        // has had time to, and then the rows are left as they are. A step or turn
        // can stay open for good, and `started_at` against the clock says so.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, deps.retryMs ?? RETRY_MS));
          try {
            if (await within(deps.transact((tx) => close(traceRepository(tx))))) return;
          } catch {
            // The audit row says the trace was lost.
          }
        }
        return;
      }
      if (ledger.dropped() > 0) {
        // The last place in the turn is kept for saying that others were left out.
        pending.push({
          seq: ledger.closingSeq(),
          stepId: null,
          kind: 'truncated',
          payload: { dropped: ledger.dropped() },
          at: endedAt,
        });
      }
      return commit(async (repo) => {
        await close(repo);
      });
    },

    know: (secret) => {
      masker.know(secret);
    },

    lost: () => failed,
  };
}
