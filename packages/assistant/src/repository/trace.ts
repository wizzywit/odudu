// The trace's writes: a turn opens, each model call is a step that opens and
// closes, and events are appended in order. Reads belong to the activity screen
// and are not here. Every write names its tenant, and the table's policy checks
// that it is the one the transaction is bound to.
import { and, eq, isNull } from 'drizzle-orm';
import type { JsonValue } from '@odudu/mcp';
import { assistantEvents, assistantSteps, assistantTurns } from '#/schema/assistant-trace';
import { type AssistantTx } from '#/repository/tx';
import type { Slot } from '#/service/slots';

export const EVENT_KINDS = [
  'model_call',
  'text',
  'tool_call',
  'tool_result',
  'tool_error',
  'error',
  'slot_chosen',
  'reservation',
  'narrowing',
  'policy',
  'trimming',
  'truncated',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface NewTurn {
  readonly tenantId: string;
  readonly id: string;
  readonly conversationId: string;
  readonly profile: string;
  readonly promptHash: string;
  readonly startedAt: Date;
}

export interface NewStep {
  readonly tenantId: string;
  readonly turnId: string;
  readonly id: string;
  readonly parentStepId: string | null;
  readonly slot: Slot;
  readonly model: string;
  readonly startedAt: Date;
}

export interface StepEnd {
  readonly tenantId: string;
  readonly id: string;
  readonly providerRequestId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly endedAt: Date;
}

export interface NewEvent {
  readonly seq: number;
  readonly stepId: string | null;
  readonly kind: EventKind;
  readonly payload: JsonValue;
  readonly at: Date;
}

export function traceRepository(tx: AssistantTx) {
  return {
    async openTurn(turn: NewTurn): Promise<void> {
      await tx.insert(assistantTurns).values(turn);
    },

    async openStep(step: NewStep): Promise<void> {
      await tx.insert(assistantSteps).values(step);
    },

    /** Closes a step that is still open; false for one that is not this tenant's or already closed. */
    async closeStep(end: StepEnd): Promise<boolean> {
      const closed = await tx
        .update(assistantSteps)
        .set({
          providerRequestId: end.providerRequestId,
          inputTokens: end.inputTokens,
          outputTokens: end.outputTokens,
          endedAt: end.endedAt,
        })
        .where(
          and(
            eq(assistantSteps.tenantId, end.tenantId),
            eq(assistantSteps.id, end.id),
            isNull(assistantSteps.endedAt),
          ),
        )
        .returning({ id: assistantSteps.id });
      return closed.length > 0;
    },

    /** Appends events to a turn, in the order given; the writer holds each turn to its cap. */
    async appendEvents(
      tenantId: string,
      turnId: string,
      events: readonly NewEvent[],
    ): Promise<void> {
      if (events.length === 0) return;
      await tx
        .insert(assistantEvents)
        .values(events.map((event) => ({ ...event, tenantId, turnId })));
    },

    /** Closes a turn that is still open; false for one that is not this tenant's or already closed. */
    async closeTurn(
      tenantId: string,
      id: string,
      endedAt: Date,
      stopReason: string,
    ): Promise<boolean> {
      const closed = await tx
        .update(assistantTurns)
        .set({ endedAt, stopReason })
        .where(
          and(
            eq(assistantTurns.tenantId, tenantId),
            eq(assistantTurns.id, id),
            isNull(assistantTurns.endedAt),
          ),
        )
        .returning({ id: assistantTurns.id });
      return closed.length > 0;
    },
  };
}
