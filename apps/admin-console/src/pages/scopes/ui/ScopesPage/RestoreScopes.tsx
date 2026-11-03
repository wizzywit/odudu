import { useRestoreScopes } from '#/pages/scopes/use-cases/useRestoreScopes';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';

export function RestoreScopes({ tenant }: { tenant: string }) {
  const restore = useRestoreScopes(tenant);
  return (
    <>
      <Button onPress={restore.ask}>Restore built-in scopes</Button>
      <ConfirmDialog
        isOpen={restore.open}
        title={restore.title}
        consequence={restore.text}
        confirmLabel={restore.confirmLabel}
        tone="primary"
        held={restore.held}
        busy={restore.busy}
        problem={restore.problem}
        onConfirm={restore.confirm}
        onCancel={restore.cancel}
      />
    </>
  );
}
