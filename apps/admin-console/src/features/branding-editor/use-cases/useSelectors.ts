import { useStylesheetHooks } from '#/features/branding-editor/repository/useStylesheetHooks';
import {
  selectorOptions,
  valueOptions,
  type SelectorOption,
} from '#/features/branding-editor/services/selectors';
import { mapRead, type Read } from '#/shared/services/read';

// What a rule of a stylesheet may name, as the entries to choose from.
export function useSelectors(tenant: string): Read<SelectorOption[]> {
  return mapRead(useStylesheetHooks(tenant), selectorOptions);
}

// The design values a declaration may use, from the same read.
export function useDesignValues(tenant: string): Read<SelectorOption[]> {
  return mapRead(useStylesheetHooks(tenant), valueOptions);
}
