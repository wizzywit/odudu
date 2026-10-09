import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { sectionsOf } from '#/shared/service/record.ts';

const NONE: ReadonlySet<string> = new Set();

// The sections of one record with unsaved edits, by the section id each
// gave `useSectionSave`, so its tabs can carry their dots.
// A record there is not has none.
export function useDirtySections(tenant: string, record: string | null): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  return record === null ? NONE : sectionsOf(dirty.keys(), tenant, record);
}
