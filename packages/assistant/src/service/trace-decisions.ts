import { createHash } from 'node:crypto';
import type { LanguageModel, ModelMessage, ToolApprovalStatus } from 'ai';
import type { LevelName } from '#/service/limits';
import type { Slot } from '#/service/slots';
import type { TurnMode } from '#/service/turn-summary';

// What the trace keeps of a choice the turn's own code made. Each is a plain
// record of names and counts: no message text, no tool input, no reason a
// model is told, so nothing here needs masking.

/** A digest of the system prompt, which is not stored: the same prompt gives the same hash. */
export function promptHashOf(staticText: string, tenantText: string): string {
  // Length-prefixed, so moving a character from one part to the other changes the hash.
  const parts = [staticText, tenantText].map((part) => `${String(part.length)}:${part}`);
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function slotDecision(
  slot: Slot,
  profile: string,
  model: LanguageModel,
): Record<string, unknown> {
  return {
    slot,
    profile,
    reason: 'profile',
    ...(typeof model === 'string'
      ? { model_id: model }
      : { provider: model.provider, model_id: model.modelId }),
  };
}

export function reservationDecision(held: {
  readonly slot: Slot;
  readonly tokens: number;
  readonly fixedBytes: number;
  readonly messagesBytes: number;
  readonly refusedBy?: LevelName;
}): Record<string, unknown> {
  return {
    slot: held.slot,
    tokens: held.tokens,
    fixed_bytes: held.fixedBytes,
    messages_bytes: held.messagesBytes,
    ...(held.refusedBy === undefined
      ? { outcome: 'reserved' }
      : { outcome: 'refused', level: held.refusedBy }),
  };
}

export function narrowingDecision(
  mode: TurnMode,
  reads: number,
  writes: number,
): Record<string, unknown> {
  return { mode, reads, writes };
}

export function policyDecision(
  tool: string,
  mode: TurnMode,
  verdict: 'deny' | 'ask',
  status: ToolApprovalStatus | undefined,
): Record<string, unknown> {
  let outcome = 'allowed';
  if (status === 'user-approval') outcome = 'approval_requested';
  else if (typeof status === 'object' && status.type === 'denied') outcome = 'denied';
  return { tool, mode, verdict, outcome };
}

/**
 * How many messages compaction left out or cut, or undefined when it touched
 * none. A message it did not touch comes back as the same object.
 */
export function trimmingDecision(
  before: readonly ModelMessage[],
  after: readonly ModelMessage[],
): Record<string, unknown> | undefined {
  const original = new Set(before);
  const untouched = after.filter((message) => original.has(message)).length;
  const trimmed = before.length - untouched;
  return trimmed === 0 ? undefined : { before: before.length, after: after.length, trimmed };
}
