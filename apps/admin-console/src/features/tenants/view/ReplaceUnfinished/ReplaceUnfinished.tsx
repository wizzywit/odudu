import type { Unfinished } from '#/features/tenants/service';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';

export function ReplaceUnfinished({
  unfinished,
  onReplace,
  onKeep,
}: {
  unfinished: Unfinished | null;
  onReplace: () => void;
  onKeep: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={unfinished !== null}
      title="Replace the unfinished administrator?"
      consequence={
        unfinished === null
          ? ''
          : `${unfinished.username} was created in ${unfinished.tenant}, but has not yet been given ${unfinished.granted ? 'a one-time password' : 'what they hold and a one-time password'}. Starting over leaves ${unfinished.username} as they are; keep it to finish them first.`
      }
      confirmLabel="Replace it"
      tone="danger"
      onConfirm={onReplace}
      onCancel={onKeep}
    />
  );
}
