export const FENCE_OPEN = '<tool-data>';
export const FENCE_CLOSE = '</tool-data>';

const ANGLE = /</gu;

/**
 * The one escaping rule for everything put inside a fence: each `<` becomes
 * the JSON escape `<`, so no text can spell, split or nest a marker, and
 * a JSON payload stays valid JSON.
 */
export function escapeAngles(text: string): string {
  return text.replace(ANGLE, '\\u003c');
}

export function fence(inner: string): string {
  return `${FENCE_OPEN}${escapeAngles(inner)}${FENCE_CLOSE}`;
}
