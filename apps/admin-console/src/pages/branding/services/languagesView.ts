import type { Choice } from '#/shared/lib/services/choice';
import { ADD_BUTTON, ADD_LABEL, ADD_NOTE } from '#/pages/branding/services/addedLanguage';
import {
  LANGUAGES_DESCRIPTION,
  LANGUAGES_SECTION,
  LANGUAGES_TITLE,
} from '#/pages/branding/services/languagesSection';
import {
  defaultChoices,
  DEFAULT_LABEL,
  DEFAULT_NOTE,
  SUPPORTED_LABEL,
  SUPPORTED_NOTE,
  supportedChoices,
  type LanguageValues,
} from '#/pages/branding/services/supportedLanguages';

export const LANGUAGES_WORDS = {
  title: LANGUAGES_TITLE,
  headingId: `branding-${LANGUAGES_SECTION}`,
  lead: LANGUAGES_DESCRIPTION,
} as const;

export const ADD_WORDS = { label: ADD_LABEL, description: ADD_NOTE, button: ADD_BUTTON } as const;

export interface LanguageEdit {
  saved: readonly string[];
  values: LanguageValues;
  errors: { supported: string | undefined; fallback: string | undefined };
  changed: { supported: boolean; fallback: boolean };
}

export interface SupportedView {
  label: string;
  description: string;
  error: string | undefined;
  changed: boolean;
  options: Choice[];
  value: readonly string[];
}

export interface DefaultView {
  label: string;
  description: string;
  error: string | undefined;
  changed: boolean;
  options: Choice[];
  value: string;
}

// The two choices of the section as they stand: the languages offered, and
// which one is used ahead of the browser's preference.
export function supportedView(edit: LanguageEdit): SupportedView {
  return {
    label: SUPPORTED_LABEL,
    description: SUPPORTED_NOTE,
    error: edit.errors.supported,
    changed: edit.changed.supported,
    options: supportedChoices(edit.saved, edit.values.supported_locales),
    value: edit.values.supported_locales,
  };
}

export function defaultView(edit: LanguageEdit): DefaultView {
  return {
    label: DEFAULT_LABEL,
    description: DEFAULT_NOTE,
    error: edit.errors.fallback,
    changed: edit.changed.fallback,
    options: defaultChoices(edit.values.supported_locales),
    value: edit.values.default_locale,
  };
}

export const LANGUAGES_TAB_WORDS = {
  loading: 'Loading the languages',
  failed: 'The languages could not be loaded',
  fields: 3,
} as const;
