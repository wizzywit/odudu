import { type z } from 'zod';

// U+202A to U+202E (embeddings and overrides) and U+2066 to U+2069
// (isolates). LRM, RLM and ALM are marks that Persian and Arabic text
// legitimately carries and reorder nothing around them, so they stay.
const CONTROLS = '\\u202A-\\u202E\\u2066-\\u2069';

export const BIDI_REFUSED = 'bidi_control_refused';

export const BIDI_REFUSED_MESSAGE =
  'must not contain bidirectional control characters (U+202A to U+202E, U+2066 to U+2069)';

// A negative pattern rather than a refinement: the admin API validates a body
// through the JSON Schema `z.toJSONSchema` emits, which carries a pattern and
// drops a refinement, so this is the one form every door enforces.
export const BIDI_FREE_PATTERN = new RegExp(`^[^${CONTROLS}]*$`, 'u');

const CONTROL = new RegExp(`[${CONTROLS}]`, 'u');
const CONTROLS_GLOBAL = new RegExp(`[${CONTROLS}]`, 'gu');

export function containsBidiControl(value: string): boolean {
  return CONTROL.test(value);
}

/**
 * Whether writing `next` over `current` is refused: it holds a control and is
 * not exactly what is already stored. A value a row held before the rule
 * existed never blocks an unrelated edit, and is never rewritten.
 */
export function refusesBidi(next: string | null | undefined, current?: string | null): boolean {
  return typeof next === 'string' && next !== current && containsBidiControl(next);
}

export function stripBidiControls(value: string): string {
  return value.replace(CONTROLS_GLOBAL, '');
}

/** The one rule a typed identity or name field is held to, wherever it is written. */
export function noBidiControls<T extends z.ZodString>(schema: T): T {
  return schema.regex(BIDI_FREE_PATTERN, { error: BIDI_REFUSED_MESSAGE });
}

// PostgreSQL `text` cannot hold U+0000, so a name or a description carrying one
// would be a server error at the write instead of a refusal at the request.
export const NUL_REFUSED_MESSAGE = 'must not contain a NUL (U+0000) character';

export function containsNul(value: string): boolean {
  return value.includes('\u0000');
}

// The same refusal as a pattern, which is the form the admin API's body
// validation enforces, so the request is answered 400 with the field's name.
export function noNul<T extends z.ZodString>(schema: T): T {
  return schema.regex(/^[^\u0000]*$/u, { error: `text ${NUL_REFUSED_MESSAGE}` });
}
