import type { SectionFields } from '#/shared/services/sectionSave';
import {
  type LanguageValues,
  SUPPORTED_LABEL,
  DEFAULT_LABEL,
  DEFAULT_NONE,
} from '#/pages/branding/services/supportedLanguages';

export const LANGUAGES_SECTION = 'languages';

export const LANGUAGES_TITLE = 'Languages';

export const LANGUAGES_DESCRIPTION =
  'The languages the tenant’s pages and mail are offered in, and the one used when a visitor’s browser does not decide.';

// The section's fields as the save reads them: the label a conflict or a
// restored draft names, and how a value reads aloud.
export function languageFields(base: LanguageValues): SectionFields<LanguageValues> {
  return {
    supported_locales: {
      value: base.supported_locales,
      label: SUPPORTED_LABEL,
      kind: 'plain',
      describe: (value) => (Array.isArray(value) ? value.join(', ') : ''),
    },
    default_locale: {
      value: base.default_locale,
      label: DEFAULT_LABEL,
      kind: 'plain',
      describe: (value) => (value === '' ? DEFAULT_NONE : String(value)),
    },
  };
}
