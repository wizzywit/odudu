import { useStylesheetHooks } from '#/features/branding/repository/useStylesheetHooks';
import { selectorOptions, valueOptions, type SelectorOption } from '#/features/branding/services';
import { mapRead, type Read } from '#/shared/services/read';

// What a rule of a stylesheet may name, as the entries to choose from.
export function useSelectors(tenant: string): Read<SelectorOption[]> {
  return mapRead(useStylesheetHooks(tenant), selectorOptions);
}

// The design values a declaration may use, from the same read.
export function useDesignValues(tenant: string): Read<SelectorOption[]> {
  return mapRead(useStylesheetHooks(tenant), valueOptions);
}
