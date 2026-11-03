import type { FieldError, PublishThemeResponse } from '@odudu/contracts/admin';
import { problemSubtype } from '#/shared/services/failure';
import { moreProblems, PROBLEMS_SHOWN } from '#/features/branding/services/problems';
import type { Problem } from '#/shared/services/result';
import { NO_DRAFT_HOLD, NOTHING_TO_PUBLISH } from '#/features/branding/services/publishDraft';

export function issueLine(error: FieldError): string {
  const place =
    error.line === undefined || error.line === null
      ? ''
      : ` (line ${String(error.line)}${error.column === undefined || error.column === null ? '' : `, column ${String(error.column)}`})`;
  return `${error.path}: ${error.message}${place}`;
}

export interface Issues {
  lines: readonly string[];
  // Said after the lines when the server named more than are shown.
  more: string | null;
}

export function issuesOf(errors: readonly FieldError[] | undefined): Issues {
  const all = errors ?? [];
  const lines = all.slice(0, PROBLEMS_SHOWN).map(issueLine);
  const rest = all.length - lines.length;
  return {
    lines,
    more: rest > 0 ? `and ${moreProblems(rest)}` : null,
  };
}

export const NO_ISSUES: Issues = { lines: [], more: null };

export function warningLines(response: PublishThemeResponse): readonly string[] {
  return response.warnings.map((warning) => `${warning.piece}: ${warning.message}`);
}

export const WARNINGS_TITLE = 'Published, with a warning';

export const WARNINGS_NOTE =
  'A stylesheet or a template cannot be proven accessible. Published anyway; check the pages yourself.';

// What the server's refusal of a publish or restore comes to in words.
export function refusalText(problem: Problem, verb: string): string | null {
  const subtype = problemSubtype(problem);
  if (subtype === 'theme-no-draft') return NO_DRAFT_HOLD;
  if (subtype === 'theme-nothing-to-publish') return NOTHING_TO_PUBLISH;
  if (subtype === 'theme-assets-missing') {
    return `This version cannot be ${verb}: an image it names has been deleted.`;
  }
  if (subtype === 'theme-version-fails-checks') {
    return `This version cannot be ${verb}: some of its pieces fail today’s checks.`;
  }
  if (problem.status === 400) return `The theme was not ${verb}. Fix what is listed.`;
  return null;
}

export function publishConflict(): string {
  return 'Somebody saved the draft after you opened it. The page now shows their version: look it over, then publish.';
}

// A refusal that joins many problems, cut to as many as one field shows.
export function limitedIssues(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const parts = text.split('; ');
  if (parts.length <= PROBLEMS_SHOWN) return text;
  const rest = parts.length - PROBLEMS_SHOWN;
  return `${parts.slice(0, PROBLEMS_SHOWN).join('; ')}; and ${moreProblems(rest)}`;
}

export const ISSUES_LABEL = 'What the server refused';
