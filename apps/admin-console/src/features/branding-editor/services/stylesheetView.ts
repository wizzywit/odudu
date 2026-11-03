import {
  pickerWording,
  type PickerWording,
} from '#/features/branding-editor/services/pickerWording';
import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { Read } from '#/shared/lib/services/read';
import { LIST_LIMIT } from '#/features/branding-editor/services/catalogue';
import {
  SELECTORS_FAILED,
  SELECTORS_LABEL,
  SELECTORS_LOADING,
  SELECTORS_NOTE,
  VALUES_FAILED,
  VALUES_LABEL,
  VALUES_LOADING,
  VALUES_NOTE,
  type SelectorOption,
} from '#/features/branding-editor/services/selectors';
import { sourceReading } from '#/features/branding-editor/services/sources';
import {
  STYLESHEET_LABEL,
  STYLESHEET_LEAD,
  STYLESHEET_SECTION_TITLE,
} from '#/features/branding-editor/services/stylesheet';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

export interface StylesheetWords {
  title: string;
  lead: string;
  label: string;
  // Which layer supplies the stylesheet.
  description: string;
}

export function stylesheetWords(scope: ThemeScope, view: ThemeView): StylesheetWords {
  return {
    title: STYLESHEET_SECTION_TITLE,
    lead: STYLESHEET_LEAD,
    label: STYLESHEET_LABEL,
    description: `${sourceReading(scope, view, 'stylesheet')}.`,
  };
}

export interface InsertList {
  options: Read<SelectorOption[]>;
  wording: PickerWording;
  limit: number;
  label: string;
  description: string;
}

export function selectorList(options: Read<SelectorOption[]>): InsertList {
  return {
    options,
    wording: pickerWording(SELECTORS_LOADING, SELECTORS_FAILED),
    limit: LIST_LIMIT,
    label: SELECTORS_LABEL,
    description: SELECTORS_NOTE,
  };
}

export function valueList(options: Read<SelectorOption[]>): InsertList {
  return {
    options,
    wording: pickerWording(VALUES_LOADING, VALUES_FAILED),
    limit: LIST_LIMIT,
    label: VALUES_LABEL,
    description: VALUES_NOTE,
  };
}
