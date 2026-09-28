import { Button } from '#/shared/view/Button.tsx';
import { DialogFrame } from '#/shared/view/DialogFrame.tsx';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export function UnsavedChangesDialog({
  isOpen,
  sections,
  onStay,
  onLeave,
}: {
  readonly isOpen: boolean;
  readonly sections: readonly string[];
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  return (
    <DialogFrame
      isOpen={isOpen}
      role="alertdialog"
      title="Leave without saving?"
      description={`Your unsaved changes to ${LIST.format(sections)} will be lost.`}
      onEscape={onStay}
      actions={
        <>
          <Button variant="danger" onPress={onLeave}>
            Discard changes and leave
          </Button>
          <Button variant="primary" autoFocus onPress={onStay}>
            Stay
          </Button>
        </>
      }
    />
  );
}
