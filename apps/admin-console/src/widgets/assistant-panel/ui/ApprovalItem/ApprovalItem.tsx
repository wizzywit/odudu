import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import type { StepState } from '#/widgets/assistant-panel/types/chat';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { useApprovalCard } from '#/widgets/assistant-panel/use-cases/useApprovalCard';
import { ApprovalCard } from '#/widgets/assistant-panel/ui/ApprovalCard';

// One card, kept up to date by the server's clock. A change of tier B or C asks
// once more before the approval is sent, and tier C holds it until the name the
// server wrote is typed; a change of tier A is approved or refused from the card.
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
  onDecide: (entry: Entry, approve: boolean, confirm?: string) => void;
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
        title={card.model.dialog.title}
        consequence={card.model.dialog.consequence}
        confirmLabel={card.model.dialog.confirmLabel}
        {...(card.model.dialog.typed === null ? {} : { typed: card.model.dialog.typed })}
        tone="danger"
        onConfirm={card.confirm}
        onCancel={card.cancel}
      />
    </>
  );
}
