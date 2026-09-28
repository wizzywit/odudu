import { useState, type SubmitEvent, type ReactNode } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import { DialogFrame } from '#/shared/view/DialogFrame.tsx';
import { TextField } from '#/shared/view/Field.tsx';

interface ConfirmProps {
  readonly title: string;
  readonly consequence: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: 'primary' | 'danger';
  // When set, confirm stays disabled until exactly this text is typed.
  readonly typed?: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({ isOpen, ...props }: ConfirmProps & { readonly isOpen: boolean }) {
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
  const [entered, setEntered] = useState('');
  const ready = !busy && (typed === undefined || entered === typed);
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
          <Button variant={tone} isDisabled={!ready} onPress={confirm}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
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
