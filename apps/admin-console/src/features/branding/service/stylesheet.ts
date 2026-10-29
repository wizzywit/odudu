import { MAX_STYLESHEET_BYTES, MAX_TEMPLATE_BYTES } from '@odudu/contracts';
import type { FieldError } from '@odudu/contracts/admin';
import { byteSizeReading, utf8Length, type SizeReading } from '#/shared/service/format';
import type { PublishOutcome } from '#/features/branding/service/edits';
import { SELECTORS_LABEL } from '#/features/branding/service/selectors';
import {
  detailed,
  NO_PROBLEMS,
  placedProblems,
  type PlacedProblems,
} from '#/features/branding/service/problems';

export const STYLESHEET_LEAD =
  'Plain CSS for what the page’s own styling cannot do. Rules may name only the page’s documented classes, such as .logo and .page-sign-in; @import, @font-face, scripts and addresses outside this theme’s images are refused. The preview shows the saved stylesheet, so save to see a change.';

const LIST_POINTER = `“${SELECTORS_LABEL}” above the editor lists what a rule may name.`;

export const STYLESHEET_LABEL = 'Stylesheet CSS';

export const STYLESHEET_PATH = 'stylesheet';

export const STYLESHEET_REFUSED = 'The stylesheet was not saved.';

export const STYLESHEET_UNPUBLISHABLE = 'The saved stylesheet was refused at publish.';

export const STYLESHEET_OVER = 'The stylesheet is over the size limit.';

// How much of a limit in bytes a text uses, or by how much it is over.
export function sizeReading(text: string, limit: number): SizeReading {
  return byteSizeReading(utf8Length(text), limit);
}

export function stylesheetSize(text: string): SizeReading {
  return sizeReading(text, MAX_STYLESHEET_BYTES);
}

export function templateSize(text: string): SizeReading {
  return sizeReading(text, MAX_TEMPLATE_BYTES);
}

export function stylesheetHold(text: string): string | undefined {
  return stylesheetSize(text).over ? STYLESHEET_OVER : undefined;
}

// What the server's stylesheet check refuses, by its code, in the console's
// words. A test holds the keys to the server's list.
export const STYLESHEET_REFUSALS: Readonly<Record<string, string>> = {
  'too-large': 'The stylesheet is larger than the limit. Remove what you do not need.',
  unparsable: 'The stylesheet cannot be read as CSS.',
  'nul-byte': 'The stylesheet holds a NUL character. Remove it.',
  'root-declaration': 'A declaration must sit inside a rule.',
  'at-rule-not-allowed': 'This at-rule is not allowed. Only @media is.',
  'media-query-not-allowed':
    'This media query is not allowed. Colour scheme, width and reduced motion are.',
  'selector-not-allowed': `This selector is not allowed. ${LIST_POINTER}`,
  'unknown-class': `This class is not one of the page’s documented classes. ${LIST_POINTER}`,
  'property-not-allowed': 'This property is not allowed.',
  'value-not-allowed': 'This value is not allowed.',
  'url-not-allowed': 'A url() may name only this theme’s uploaded images.',
  'too-many-rules': 'The stylesheet has more rules than the limit.',
  'too-many-declarations': 'The stylesheet has more declarations than the limit.',
  'too-long': 'A selector or value is longer than the limit.',
  'too-many-issues': 'There are more problems than are listed. Fix these and save again.',
};

function wording(error: FieldError): string {
  const known = error.code === undefined ? undefined : STYLESHEET_REFUSALS[error.code];
  return detailed(known ?? error.message, error);
}

// What a refused save says about the stylesheet: the refusals that name a
// line are marked on it, the rest are said under the editor.
export function stylesheetProblems(
  errors: readonly FieldError[],
  saved: string | undefined,
): PlacedProblems {
  return placedProblems(errors, saved, {
    path: STYLESHEET_PATH,
    refused: STYLESHEET_REFUSED,
    wording,
  });
}

// What a refused publish says about the stylesheet, for as long as the draft
// it refused is the one on screen.
export function publishedStylesheetProblems(
  outcome: PublishOutcome,
  tag: string,
  changed: boolean,
): PlacedProblems {
  if (changed || outcome.atTag !== tag) return NO_PROBLEMS;
  return placedProblems(outcome.errors, undefined, {
    path: STYLESHEET_PATH,
    refused: STYLESHEET_UNPUBLISHABLE,
    wording,
  });
}
