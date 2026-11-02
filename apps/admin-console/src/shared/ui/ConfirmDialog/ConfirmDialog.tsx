import { useId, useState, type SubmitEvent, type ReactNode } from 'react';
import type { DialogAsk } from '#/shared/services/dialog';
import { Button } from '#/shared/ui/Button';
import { KeyHint } from '#/shared/ui/KeyHint';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { DialogFrame } from '#/shared/ui/DialogFrame';
import { TextField } from '#/shared/ui/Field';
import styles from '#/shared/ui/ConfirmDialog/ConfirmDialog.module.css';

interface ConfirmProps {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  // When set, confirm stays disabled until exactly this text is typed.
  typed?: string;
  busy?: boolean;
  // The server's refusal of the action, said where the action is.
  problem?: ReactNode;
  // Held when trying again could only be refused again.
  held?: boolean;
  // One thing the confirmation offers to do as well, ticked or not.
  choice?: { label: string; note: string; checked: boolean; onChange: (checked: boolean) => void };
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, ...props }: ConfirmProps & { isOpen: boolean }) {
  return isOpen ? <OpenConfirm {...props} /> : null;
}

// A confirmation a usecase has asked for, open while there is one. Danger
// unless the one asked says otherwise.
export function AskedDialog({
  asked,
  confirmLabel,
  busy,
  problem,
  choice,
  onConfirm,
  onCancel,
}: {
  asked: DialogAsk | null;
  // Where the action is named by the page, not by what was asked.
  confirmLabel?: string;
  busy?: boolean;
  problem?: ReactNode;
  // Whether the choice `asked` offers is ticked, and how it changes.
  choice?: { checked: boolean; onChange: (checked: boolean) => void } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={asked !== null}
      title={asked?.title ?? ''}
      consequence={asked?.consequence ?? ''}
      confirmLabel={confirmLabel ?? asked?.confirmLabel ?? ''}
      tone={asked?.tone ?? 'danger'}
      {...(typeof asked?.typed === 'string' ? { typed: asked.typed } : {})}
      {...(busy === undefined ? {} : { busy })}
      {...(problem === undefined ? {} : { problem })}
      {...(asked?.choice === undefined || choice === undefined || choice === null
        ? {}
        : { choice: { ...asked.choice, ...choice } })}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function OpenConfirm({
  title,
  consequence,
  confirmLabel,
  tone = 'primary',
  typed,
  busy = false,
  problem,
  held = false,
  choice,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const shortcut = useId();
  const [entered, setEntered] = useState('');
  // Case counts; a space picked up by pasting the name does not.
  const ready = !busy && !held && (typed === undefined || entered.trim() === typed);
  const confirm = (): void => {
    if (ready) onConfirm();
  };
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    confirm();
  };
  return (
    <DialogFrame
      isOpen
      role="alertdialog"
      title={title}
      description={consequence}
      {...(busy ? {} : { onEscape: onCancel })}
      actions={
        <>
          <Button
            isDisabled={busy}
            onPress={onCancel}
            {...(typed === undefined ? { autoFocus: true } : {})}
          >
            Cancel
          </Button>
          <Button
            variant={tone}
            isDisabled={!ready}
            onPress={confirm}
            {...(typed === undefined ? {} : { 'aria-describedby': shortcut })}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
          {typed === undefined ? null : (
            <span className={styles.shortcut}>
              <KeyHint id={shortcut} lead="or press" keys={['Enter']} />
            </span>
          )}
        </>
      }
    >
      {typed === undefined && problem === undefined && choice === undefined ? undefined : (
        <>
          {choice === undefined ? null : (
            <ChecklistField
              label="Options"
              options={[{ id: 'choice', label: choice.label, description: choice.note }]}
              value={choice.checked ? ['choice'] : []}
              onChange={(chosen) => {
                choice.onChange(chosen.includes('choice'));
              }}
            />
          )}
          {typed === undefined ? null : (
            <form noValidate onSubmit={submit}>
              <TextField
                label={`Type ${typed} to confirm`}
                value={entered}
                onChange={setEntered}
                mono
                autoFocus
              />
            </form>
          )}
          {problem === undefined || problem === null ? null : (
            <p role="alert" className={styles.problem}>
              {problem}
            </p>
          )}
        </>
      )}
    </DialogFrame>
  );
}
