import { andList } from '#/shared/lib/services/format';
import { Button } from '#/shared/ui/Button';
import { DialogFrame } from '#/shared/ui/DialogFrame';

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
      description={`Your unsaved changes to ${andList(sections)} will be lost.`}
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
