import { Button } from '#/shared/view/Button';
import { DialogFrame } from '#/shared/view/DialogFrame';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export function UnsavedChangesDialog({
  isOpen,
  sections,
  onStay,
  onLeave,
}: {
  isOpen: boolean;
  sections: readonly string[];
  onStay: () => void;
  onLeave: () => void;
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
