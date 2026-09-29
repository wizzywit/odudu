import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

// The sections of one record with unsaved edits, by the section id each
// gave `useSectionSave`, so its tabs can carry their dots.
export function useDirtySections(tenant: string, record: string): ReadonlySet<string> {
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  const prefix = `${tenant}/${record}#`;
  return new Set(
    [...dirty.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  );
}
