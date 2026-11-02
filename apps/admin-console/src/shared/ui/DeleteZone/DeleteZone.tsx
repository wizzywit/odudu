import type { ReactNode } from 'react';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';

// The foot of a record's General tab: what a delete takes with it, a danger
// button and the confirmation. `note` stands in for the button where the
// delete is not on offer or not yet known to be.
export function DeleteZone({
  name,
  deletion,
  consequence,
  typed,
  label,
  lead,
  note,
  held = false,
  retry = null,
}: {
  name: string;
  deletion: {
    confirming: boolean;
    busy: boolean;
    problem: string | null;
    ask: () => void;
    cancel: () => void;
    confirm: () => void;
  };
  // What the dialog says is lost.
  consequence: ReactNode;
  // Held until this text is typed, where two records may share a name.
  typed?: string;
  // The button's text, where "Delete" and the name would say too little.
  label?: string;
  lead?: ReactNode;
  note?: ReactNode;
  // Holds the confirmation while what the delete affects is not yet known.
  held?: boolean;
  // Offered in the dialog when that could not be read.
  retry?: { text: string; label: string; run: () => void } | null;
}) {
  return (
    <Panel title="Delete">
      {lead}
      {note ?? (
        <div className={recordTab.actions}>
          <Button variant="danger" onPress={deletion.ask}>
            {label ?? `Delete ${name}`}
          </Button>
        </div>
      )}
      <ConfirmDialog
        isOpen={deletion.confirming}
        title={`Delete ${name}?`}
        consequence={consequence}
        confirmLabel={`Delete ${name}`}
        tone="danger"
        {...(typed === undefined ? {} : { typed })}
        held={held}
        busy={deletion.busy}
        problem={
          deletion.problem ??
          (retry === null ? null : (
            <>
              {retry.text}{' '}
              <Button size="small" onPress={retry.run}>
                {retry.label}
              </Button>
            </>
          ))
        }
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </Panel>
  );
}
