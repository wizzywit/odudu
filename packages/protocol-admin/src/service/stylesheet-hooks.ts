import { type StylesheetHooksResponse } from '@odudu/contracts/admin';
import {
  CSS_ELEMENTS,
  CSS_HOOKS_VERSION,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  CSS_TOKENS,
  PAGE_KIND_HOOKS,
  RENDERED_HOOKS,
} from '@odudu/domain-theme';

// Part of the build and the same for every tenant, so it is made once.
const ANSWER: StylesheetHooksResponse = {
  version: CSS_HOOKS_VERSION,
  classes: [...RENDERED_HOOKS],
  page_kind_classes: [...PAGE_KIND_HOOKS],
  elements: [...CSS_ELEMENTS],
  pseudo_classes: [...CSS_PSEUDO_CLASSES],
  pseudo_elements: [...CSS_PSEUDO_ELEMENTS],
  tokens: [...CSS_TOKENS],
};

// What a tenant stylesheet's selectors and values may name, which is what the
// stylesheet checker accepts: its lists, not a copy of them.
export function stylesheetHooks(): StylesheetHooksResponse {
  return ANSWER;
}
