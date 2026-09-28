import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { UnsavedChangesDialog } from '#/shared/view/UnsavedChangesDialog.tsx';

// The one reader of the guard's held departure, as ToastLayer is of the queue.
export function UnsavedGuardLayer() {
  const pending = useUnsavedGuard((guard) => guard.pending);
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  const stay = useUnsavedGuard((guard) => guard.stay);
  const leave = useUnsavedGuard((guard) => guard.leave);
  return (
    <UnsavedChangesDialog
      isOpen={pending !== null}
      sections={[...dirty.values()]}
      onStay={stay}
      onLeave={leave}
    />
  );
}
