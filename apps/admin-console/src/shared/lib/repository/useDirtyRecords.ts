import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { recordsWithEdits } from '#/shared/lib/services/record';

// Which of these records has a section holding unsaved edits.
export function useDirtyRecords(tenant: string, records: readonly string[]): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  return recordsWithEdits(dirty.keys(), tenant, records);
}
