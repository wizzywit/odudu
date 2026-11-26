import { AsyncLocalStorage } from 'node:async_hooks';
import type { Telemetry } from 'ai';
import { traceRepository, type EventKind, type NewEvent } from '#/repository/trace';
import type { AssistantTx } from '#/repository/tx';
import { cutText } from '#/service/cut';
import type { StopReason } from '#/service/limits';
import { createMasker } from '#/service/mask-secrets';
import type { Slot } from '#/service/slots';
import {
  boundPayload,
  payloadBytes,
  toJson,
  TURN_BYTES,
  TURN_EVENTS,
} from '#/service/trace-payload';

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
  /** A write failed, so the trace of this turn is incomplete. */
  lost(): boolean;
}

const MODEL_LENGTH = 200;
const REQUEST_ID_LENGTH = 256;

const orNull = (value: number | undefined): number | null => value ?? null;

// The SDK hands `onError` an event that carries the error, and a tool's own error as it is.
function errorPayload(thrown: unknown): Record<string, unknown> {
  const error =
    typeof thrown === 'object' && thrown !== null && 'error' in thrown ? thrown.error : thrown;
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'unknown', message: typeof error === 'string' ? error : '' };
}

export function traceRecorder(deps: TraceDeps): TraceRecorder {
  const masker = createMasker({ emails: deps.maskEmails });
  // A tool that runs another agent has its steps recorded under the step that called it.
  const nesting = new AsyncLocalStorage<{ readonly stepId: string }>();
  const stepOf = new Map<string, string>();
  const open = new Set<string>();
  let pending: NewEvent[] = [];
  let seq = 0;
  let bytes = 0;
  let dropped = 0;
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

  // Masked first, then bounded: a secret cut in half no longer matches a shape.
  const add = (kind: EventKind, payload: unknown, stepId: string | null): void => {
    if (failed) return;
    try {
      const kept = boundPayload(masker.mask(toJson(payload)));
      const size = payloadBytes(kept);
      if (seq >= TURN_EVENTS - 1 || bytes + size > TURN_BYTES) {
        dropped += 1;
        return;
      }
      pending.push({ seq, stepId, kind, payload: kept, at: deps.now() });
      seq += 1;
      bytes += size;
    } catch (error) {
      fail(error);
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
        await deps.transact(async (tx) => {
          const repo = traceRepository(tx);
          await work(repo);
          await repo.appendEvents(deps.tenantId, deps.turnId, batch);
        });
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
          model: cutText(`${event.provider}/${event.modelId}`, MODEL_LENGTH),
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
      open.delete(id);
      return commit(async (repo) => {
        await repo.closeStep({
          tenantId: deps.tenantId,
          id,
          providerRequestId:
            step.response.id === '' ? null : cutText(step.response.id, REQUEST_ID_LENGTH),
          inputTokens: orNull(step.usage.inputTokens),
          outputTokens: orNull(step.usage.outputTokens),
          endedAt: deps.now(),
        });
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
        add(kind, payload, null);
      });
    },

    async end(stopReason) {
      if (ended) return queue;
      ended = true;
      if (!begun || failed) return queue;
      const endedAt = deps.now();
      const unfinished = [...open];
      open.clear();
      if (dropped > 0) {
        // The last place in the turn is kept for saying that others were left out.
        pending.push({
          seq: TURN_EVENTS - 1,
          stepId: null,
          kind: 'truncated',
          payload: { dropped },
          at: endedAt,
        });
      }
      return commit(async (repo) => {
        for (const id of unfinished) {
          await repo.closeStep({
            tenantId: deps.tenantId,
            id,
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            endedAt,
          });
        }
        await repo.closeTurn(deps.tenantId, deps.turnId, endedAt, stopReason);
      });
    },

    lost: () => failed,
  };
}
