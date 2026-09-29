import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

// Which of these records has a section holding unsaved edits.
export function useDirtyRecords(tenant: string, records: readonly string[]): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  const keys = [...dirty.keys()];
  return new Set(
    records.filter((record) => keys.some((key) => key.startsWith(`${tenant}/${record}#`))),
  );
}
