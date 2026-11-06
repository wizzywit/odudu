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
// Overrides, embeddings and isolates reorder what a reader sees without
// changing what a parser reads, so the same text can say two things.
const BIDI = /[‎‏؜‪-‮⁦-⁩]/gu;
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

export function cleanText(text: string, cap: number): string {
  const clean = text.replace(CONTROL, '').replace(BIDI, '');
  if (clean.length <= cap) return clean;
  return clean.slice(0, cap - TRUNCATED.length).replace(HIGH_SURROGATE, '') + TRUNCATED;
}

export function cleanData(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return cleanText(value, TEXT_CAP);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) {
    throw new ToolProblem(
      'mcp:unexpected_response',
      'The admin API answered a document nested too deep to read',
      null,
    );
  }
  if (Array.isArray(value)) return value.map((item: unknown) => cleanData(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cleanData(item, depth + 1)]),
  );
}
