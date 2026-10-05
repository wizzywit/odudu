import { useEffect } from 'react';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

// Keeps the guard's record of one section true for as long as it is mounted,
// including after a leave that forgot it while it stayed on screen.
export function useDirtySection(section: string, label: string, dirty: boolean): void {
  const generation = useUnsavedGuard((guard) => guard.generation);
  const setDirty = useUnsavedGuard((guard) => guard.setDirty);
  const forget = useUnsavedGuard((guard) => guard.forget);
  useEffect(() => {
    setDirty(section, dirty ? label : null);
  }, [section, label, dirty, generation, setDirty]);
  useEffect(
    () => () => {
      forget(section);
    },
    [section, forget],
  );
}
