// jsdom 31 puts a space before each visually hidden suffix when it computes
// an accessible name ("Tokens , unsaved changes"); a browser does not.
export function tabName(label: string, ...suffixes: readonly string[]): RegExp {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `^${escape(label)}${suffixes.map((s) => `\\s*,\\s*${escape(s)}`).join('')}$`,
    'u',
  );
}
