import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import type { StepState } from '#/widgets/assistant-panel/types/chat';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { useApprovalCard } from '#/widgets/assistant-panel/use-cases/useApprovalCard';
import { ApprovalCard } from '#/widgets/assistant-panel/ui/ApprovalCard';

// One card, kept up to date by the server's clock. A change that removes
// something asks once more before the approval is sent; every other change is
// approved or refused from the card itself.
export function ApprovalItem({
  entry,
  username,
  actingIn,
  step,
  words,
  onDecide,
}: {
  entry: Entry;
  username: string;
  actingIn: string | null;
  // How the step that proposed the change stands.
  step: StepState;
  words: PanelWords;
  onDecide: (entry: Entry, approve: boolean) => void;
}) {
  const card = useApprovalCard(entry, username, actingIn, step, onDecide);
  return (
    <>
      <ApprovalCard
        model={card.model}
        words={words}
        onApprove={card.approve}
        onRefuse={card.refuse}
      />
      <ConfirmDialog
        isOpen={card.confirming}
        title={card.model.removal.title}
        consequence={card.model.removal.consequence}
        confirmLabel={words.removeConfirm}
        tone="danger"
        onConfirm={card.confirm}
        onCancel={card.cancel}
      />
    </>
  );
}
