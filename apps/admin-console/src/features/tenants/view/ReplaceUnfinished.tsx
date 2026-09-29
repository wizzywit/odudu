import type { BeginAdministrator } from '#/features/tenants/usecase/useBeginAdministrator.ts';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';

export function ReplaceUnfinished({ begin }: { begin: BeginAdministrator }) {
  const unfinished = begin.replacing;
  return (
    <ConfirmDialog
      isOpen={unfinished !== null}
      title="Replace the unfinished administrator?"
      consequence={
        unfinished === null
          ? ''
          : `${unfinished.username} was created in ${unfinished.tenant}, but has not yet been given ${unfinished.granted ? 'a one-time password' : 'tenant-admin and a one-time password'}. Replacing that creation leaves ${unfinished.username} as they are; keep it to finish them first from Create a tenant.`
      }
      confirmLabel="Replace it"
      tone="danger"
      onConfirm={begin.replace}
      onCancel={begin.keep}
    />
  );
}
