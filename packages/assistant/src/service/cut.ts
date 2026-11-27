const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

/**
 * The first `length` UTF-16 units of `text`, without a high surrogate left at
 * the end by a cut through a pair, which a provider may refuse as invalid text.
 */
export function cutText(text: string, length: number): string {
  return text.slice(0, Math.max(0, length)).replace(LONE_HIGH_SURROGATE, '');
}
