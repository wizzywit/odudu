import {
  detailed,
  problemsFor,
  type ProblemsReader,
} from '#/features/branding-editor/services/problems';
import type { PageKind } from '#/features/branding-editor/services/pageKinds';

export const TEMPLATE_REFUSED = 'The template was not saved.';

export const TEMPLATE_UNPUBLISHABLE = 'The saved template was refused at publish.';

// What a refused save or publish says about one page's template.
export function templateProblemsFor(kind: PageKind): ProblemsReader {
  return problemsFor({
    path: `templates.${kind}`,
    refusedSave: TEMPLATE_REFUSED,
    refusedPublish: TEMPLATE_UNPUBLISHABLE,
    wording: (error) => detailed(error.message, error),
  });
}
