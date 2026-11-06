import { stripBidiControls } from '@odudu/contracts';
import { ToolProblem } from '#/service/tool';

// What one string a tool returns may hold. A name or a description is free
// text somebody typed, so a page of them is bounded by this and by the admin
// API's own page size, not by what the text says.
export const TEXT_CAP = 1_000;
export const PROBLEM_TYPE_CAP = 200;
export const PROBLEM_TITLE_CAP = 200;
export const PROBLEM_DETAIL_CAP = 500;

const MAX_DEPTH = 32;
const TRUNCATED = '…';
const CONTROL = /(?![\n\t])\p{Cc}/gu;
// Characters that show nothing, so a reader sees one text and a model reads
// another: tags, word joiner, byte order mark, soft hyphen, zero width space.
// ZWJ and ZWNJ stay: emoji, Persian and Indic shaping need them.
const INVISIBLE = /[\u00AD\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/gu;
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

// Whether any string was cut to the cap, so a result can say so.
export interface CleanStats {
  truncated: boolean;
}

function clean(text: string, cap: number, stats?: CleanStats): string {
  // Overrides, embeddings and isolates reorder what a reader sees without
  // changing what a parser reads; the marks Persian and Arabic carry stay.
  const plain = stripBidiControls(text.replace(CONTROL, '').replace(INVISIBLE, ''));
  if (plain.length <= cap) return plain;
  if (stats !== undefined) stats.truncated = true;
  return plain.slice(0, cap - TRUNCATED.length).replace(HIGH_SURROGATE, '') + TRUNCATED;
}

// Members no response carries by contract. An open record (settings, audit
// detail, a key set) keeps whatever a server put in it, so these are dropped
// by name as a second line, never relied on as the first.
const SECRET_MEMBERS = new Set([
  'client_secret',
  'password',
  'password_hash',
  'secret_hash',
  'private_jwk_encrypted',
]);
const PRIVATE_KEY_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth']);

function withheld(key: string, isKey: boolean): boolean {
  const name = key.toLowerCase();
  return SECRET_MEMBERS.has(name) || (isKey && PRIVATE_KEY_MEMBERS.has(name));
}

export function cleanText(text: string, cap: number): string {
  return clean(text, cap);
}

export function cleanData(value: unknown, stats: CleanStats, depth = 0): unknown {
  if (typeof value === 'string') return clean(value, TEXT_CAP, stats);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) {
    throw new ToolProblem(
      'mcp:unexpected_response',
      'The admin API answered a document nested too deep to read',
      null,
    );
  }
  if (Array.isArray(value)) return value.map((item: unknown) => cleanData(item, stats, depth + 1));
  const isKey = 'kty' in value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !withheld(key, isKey))
      .map(([key, item]) => [clean(key, TEXT_CAP, stats), cleanData(item, stats, depth + 1)]),
  );
}
