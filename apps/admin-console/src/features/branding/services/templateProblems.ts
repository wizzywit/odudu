import {
  detailed,
  NO_PROBLEMS,
  placedProblems,
  type PlacedProblems,
} from '#/features/branding/services/problems';
import type { PublishOutcome } from '#/features/branding/services/publishOutcome';
import type { PageKind } from '#/features/branding/services/pageKinds';
import type { FieldError } from '@odudu/contracts/admin';

export const TEMPLATE_REFUSED = 'The template was not saved.';

export const TEMPLATE_UNPUBLISHABLE = 'The saved template was refused at publish.';

// What a refused save says about one page's template.
export function templateProblems(
  kind: PageKind,
  errors: readonly FieldError[],
  saved: string | undefined,
): PlacedProblems {
  return placedProblems(errors, saved, {
    path: `templates.${kind}`,
    refused: TEMPLATE_REFUSED,
    wording: (error) => detailed(error.message, error),
  });
}

// What a refused publish says about one page's template, for as long as the
// draft it refused is the one on screen.
export function publishedTemplateProblems(
  kind: PageKind,
  outcome: PublishOutcome,
  tag: string,
  changed: boolean,
): PlacedProblems {
  if (changed || outcome.atTag !== tag) return NO_PROBLEMS;
  return placedProblems(outcome.errors, undefined, {
    path: `templates.${kind}`,
    refused: TEMPLATE_UNPUBLISHABLE,
    wording: (error) => detailed(error.message, error),
  });
}
