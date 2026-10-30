import type { Revert } from '#/features/branding/usecase/useRevert';
import { ConflictPanel } from '#/shared/view/ConflictPanel';

// A revert the server refused because the draft moved on: the draft as it
// stands beside what the revert would write, and the choice between them.
export function RevertConflict({ revert }: { revert: Revert }) {
  return (
    <ConflictPanel
      section={revert.section}
      conflicts={revert.conflicts}
      busy={revert.busy}
      onKeepMine={revert.revert}
      onTakeTheirs={revert.takeTheirs}
    />
  );
}
