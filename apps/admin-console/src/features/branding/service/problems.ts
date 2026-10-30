import type { FieldError } from '@odudu/contracts/admin';
import type { LineIssue } from '#/shared/service/code';
import { counted } from '#/shared/service/format';

// The most refusals marked or listed at once; the server stops at 100.
export const PROBLEMS_SHOWN = 20;

// How many refusals were left out, as the words that follow "and".
export function moreProblems(rest: number): string {
  return counted(rest, 'more problem', 'more problems');
}

export interface PlacedProblems {
  // The refusals that name a line, to mark on it.
  lines: LineIssue[];
  // What shows under the editor; undefined when nothing is wrong.
  message: string | undefined;
}

export const NO_PROBLEMS: PlacedProblems = { lines: [], message: undefined };

// A refusal's own words with what it quoted of the text, when it quoted any.
export function detailed(text: string, error: FieldError): string {
  return error.detail === undefined || error.detail === '' ? text : `${text} (${error.detail})`;
}

// What a refusal says about one piece of the theme. The refusals that name
// a line are marked on it and the rest are said in the message; `saved` is
// the save's own sentence, which stands when the refusal has none of its own
// to read, and with neither there is nothing to say.
export function placedProblems(
  errors: readonly FieldError[],
  saved: string | undefined,
  { path, refused, wording }: { path: string; refused: string; wording: (e: FieldError) => string },
): PlacedProblems {
  const own = errors.filter((error) => error.path === path);
  if (own.length === 0) return saved === undefined ? NO_PROBLEMS : { lines: [], message: saved };
  const shown = own.slice(0, PROBLEMS_SHOWN);
  const placed = shown.filter((error) => typeof error.line === 'number');
  const rest = own.length - shown.length;
  const sentences = [
    refused,
    ...shown.filter((error) => typeof error.line !== 'number').map(wording),
    ...(rest > 0 ? [`And ${moreProblems(rest)}.`] : []),
  ];
  return {
    lines: placed.map((error) => ({ line: error.line ?? 1, text: wording(error) })),
    message: sentences.join(' '),
  };
}

// The first of two readings that has something to say.
export function firstProblems(first: PlacedProblems, second: PlacedProblems): PlacedProblems {
  return first.message === undefined ? second : first;
}
