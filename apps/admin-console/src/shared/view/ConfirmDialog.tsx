import { useId, useState, type SubmitEvent, type ReactNode } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import { DialogFrame } from '#/shared/view/DialogFrame.tsx';
import { TextField } from '#/shared/view/Field.tsx';
import styles from '#/shared/view/ConfirmDialog.module.css';

interface ConfirmProps {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  // When set, confirm stays disabled until exactly this text is typed.
  typed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, ...props }: ConfirmProps & { isOpen: boolean }) {
  return isOpen ? <OpenConfirm {...props} /> : null;
}

function OpenConfirm({
  title,
  consequence,
  confirmLabel,
  tone = 'primary',
  typed,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const shortcut = useId();
  const [entered, setEntered] = useState('');
  // Case counts; a space picked up by pasting the name does not.
  const ready = !busy && (typed === undefined || entered.trim() === typed);
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
            <kbd id={shortcut} className={styles.shortcut}>
              Enter
            </kbd>
          )}
        </>
      }
    >
      {typed === undefined ? undefined : (
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
    </DialogFrame>
  );
}
