import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { sectionsOf } from '#/shared/lib/services/record';

// The sections of one record with unsaved edits, by the section id each
// gave `useSectionSave`, so its tabs can carry their dots.
export function useDirtySections(tenant: string, record: string | null): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  return sectionsOf(dirty.keys(), tenant, record);
}
