import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { sectionsOf } from '#/shared/service/record.ts';

// The sections of one record with unsaved edits, by the section id each
// gave `useSectionSave`, so its tabs can carry their dots.
export function useDirtySections(tenant: string, record: string): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  return sectionsOf(dirty.keys(), tenant, record);
}
