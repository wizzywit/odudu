import type { FieldError, PublishThemeResponse, ThemeView } from '@odudu/contracts/admin';
import { problemSubtype } from '#/shared/service/failure';
import { andList } from '#/shared/service/format';
import { moreProblems, PROBLEMS_SHOWN } from '#/features/branding/service/problems';
import type { Problem } from '#/shared/service/result';

export const PUBLISH_TITLE = 'Publish';

// What the button says where the bar has no room for the longer label.
export const PUBLISH_SHORT = 'Publish';

export const PUBLISH_BODY =
  'Publishing makes the saved draft what people see on the sign-in and account pages, and keeps the version it replaces. Nothing is published until you do.';

export const NOTHING_TO_PUBLISH = 'Nothing to publish: the draft matches what people see.';

export const NO_DRAFT_HOLD = 'There is no draft to publish. Save a change first.';

export function unsavedHold(sections: readonly string[]): string {
  return `Save your changes first, in ${andList(sections.map((title) => `“${title}”`))}: publishing uses the saved draft.`;
}

export function publishHold({
  view,
  unsaved,
  contrast,
}: {
  view: ThemeView;
  unsaved: readonly string[];
  contrast: string | undefined;
}): string | undefined {
  if (unsaved.length > 0) return unsavedHold(unsaved);
  if (view.draft === null) return NO_DRAFT_HOLD;
  if (view.changed.length === 0) return NOTHING_TO_PUBLISH;
  return contrast;
}

export function publishedText(view: ThemeView): string {
  if (view.published === null) return 'Nothing published yet: people see Instrument’s own pages.';
  return `Version ${String(view.published.version)} is published.`;
}

// The short word beside the sentence, since a tag does not wrap.
export function publishedTag(view: ThemeView): { text: string; tone: 'active' | 'neutral' } {
  return view.published === null
    ? { text: 'Not published', tone: 'neutral' }
    : { text: 'Published', tone: 'active' };
}

export const PUBLISHED_TOAST = 'Theme published';

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
