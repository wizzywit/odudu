/** A pattern for the matchers that take a string or a RegExp, matching text that holds `text`. */
export function containing(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u');
}
