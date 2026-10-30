import type { Revert } from '#/features/branding/usecase/useRevert';
import {
  REVERT_CONFLICT_LEAD,
  REVERT_KEEP_HINT,
  REVERT_TAKE_HINT,
} from '#/features/branding/service';
import { ConflictPanel } from '#/shared/view/ConflictPanel';

// A revert the server refused because the draft moved on: the draft as it
// stands beside what the revert would write, and the choice between them.
export function RevertConflict({ revert }: { revert: Revert }) {
  return (
    <ConflictPanel
      section={revert.section}
      conflicts={revert.conflicts}
      lead={REVERT_CONFLICT_LEAD}
      keepHint={REVERT_KEEP_HINT}
      takeHint={REVERT_TAKE_HINT}
      busy={revert.busy}
      onKeepMine={revert.revert}
      onTakeTheirs={revert.takeTheirs}
    />
  );
}
