import { useStylesheetHooks } from '#/features/branding/repository/useStylesheetHooks';
import { selectorOptions, type SelectorOption } from '#/features/branding/service';
import { mapRead, type Read } from '#/shared/service/read';

// What a rule of a stylesheet may name, as the entries to choose from.
export function useSelectors(tenant: string): Read<SelectorOption[]> {
  return mapRead(useStylesheetHooks(tenant), selectorOptions);
}
