// U+202A to U+202E (embeddings and overrides) and U+2066 to U+2069 (isolates).
// The marks Persian and Arabic text carries reorder nothing and stay. The server
// holds the same set; a test in its MCP package holds the two together.
const CONTROLS_GLOBAL = /[‪-‮⁦-⁩]/gu;

export function stripBidiControls(value: string): string {
  return value.replace(CONTROLS_GLOBAL, '');
}
