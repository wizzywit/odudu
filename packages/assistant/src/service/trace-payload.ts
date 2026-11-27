import type { JsonValue } from '@odudu/mcp';
import { cutText } from '#/service/cut';

// The most one event's payload may take once serialised. The table refuses twice
// this, which leaves room for the spaces PostgreSQL adds when it prints jsonb.
export const EVENT_BYTES = 8_192;
// The most events one turn keeps, counting the one that says others were left out.
export const TURN_EVENTS = 500;
// The most payload bytes one turn keeps in all: 16 events of the largest size.
export const TURN_BYTES = 131_072;

const UNSERIALIZABLE = '[unserializable]';
const SLACK = 256;

export function payloadBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Any value as JSON: what JSON cannot hold is left out, and what it cannot read is named. */
export function toJson(value: unknown): JsonValue {
  try {
    // JSON.stringify answers undefined for undefined, a function or a symbol.
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : (JSON.parse(text) as JsonValue);
  } catch {
    return UNSERIALIZABLE;
  }
}

/**
 * The payload as it is when it fits `EVENT_BYTES`, and otherwise a preview of
 * its text with `truncated` set, cut so that the whole still fits. Call it on a
 * payload that has been masked: a secret cut in half no longer matches a shape.
 */
export function boundPayload(payload: JsonValue): JsonValue {
  if (payloadBytes(payload) <= EVENT_BYTES) return payload;
  const text = JSON.stringify(payload);
  const bytes = Buffer.byteLength(text);
  let length = EVENT_BYTES - SLACK;
  for (;;) {
    const bounded = { truncated: true, bytes, preview: cutText(text, length) };
    if (payloadBytes(bounded) <= EVENT_BYTES || length <= 0) return bounded;
    length = Math.floor(length * 0.75);
  }
}

// The SDK hands `onError` an event that carries the error, and a tool's own error as it is.
export function errorPayload(thrown: unknown): Record<string, unknown> {
  const error =
    typeof thrown === 'object' && thrown !== null && 'error' in thrown ? thrown.error : thrown;
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'unknown', message: typeof error === 'string' ? error : '' };
}
