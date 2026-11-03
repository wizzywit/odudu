import { useLockoutsClearAction } from '#/pages/settings/use-cases/useLockoutsClear';
import { Button } from '#/shared/ui/Button';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';

export function ClearLockouts({ tenant }: { tenant: string }) {
  const clear = useLockoutsClearAction(tenant);
  const { words } = clear;
  if (clear.state === 'checking') return null;
  return (
    <Panel title={words.heading}>
      <p className={recordTab.rule}>{words.rule}</p>
      {clear.state === 'lacking' ? (
        <CapabilityNote capability={words.needs}>{words.lacking}</CapabilityNote>
      ) : (
        <>
          <div className={recordTab.actions}>
            <Button variant="danger" onPress={clear.ask}>
              {words.heading}
            </Button>
          </div>
          {clear.more === null ? null : <p role="status">{clear.more}</p>}
          <ConfirmDialog
            isOpen={clear.confirming}
            title={words.dialogTitle}
            consequence={words.consequence}
            confirmLabel={words.confirmLabel}
            tone="danger"
            typed={tenant}
            busy={clear.busy}
            problem={clear.problem}
            onConfirm={clear.confirm}
            onCancel={clear.cancel}
          />
        </>
      )}
    </Panel>
  );
}
