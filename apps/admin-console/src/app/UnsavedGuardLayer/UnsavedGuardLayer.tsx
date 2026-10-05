import { useDialogHost } from '#/shared/repository/useDialogHost.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { DialogPresence } from '#/shared/view/dialogPresence.ts';
import { UnsavedChangesDialog } from '#/shared/view/UnsavedChangesDialog';

const UNCOUNTED = () => () => undefined;

// The one reader of the guard's held departure, as ToastLayer is of the queue.
// Dialogs are never stacked: a departure held while another dialog is open
// waits for that one to close. The guard's own dialog is left out of the count.
export function UnsavedGuardLayer() {
  const pending = useUnsavedGuard((guard) => guard.pending);
  const dirty = useUnsavedGuard((guard) => guard.dirty);
  const stay = useUnsavedGuard((guard) => guard.stay);
  const leave = useUnsavedGuard((guard) => guard.leave);
  const others = useDialogHost((host) => host.open);
  return (
    <DialogPresence value={UNCOUNTED}>
      <UnsavedChangesDialog
        isOpen={pending !== null && others === 0}
        sections={[...dirty.values()]}
        onStay={stay}
        onLeave={leave}
      />
    </DialogPresence>
  );
}
