import type { Revert } from '#/features/branding-editor/use-cases/useRevert';
import { ConflictPanel } from '#/shared/ui/ConflictPanel';

// A revert the server refused because the draft moved on: the draft as it
// stands beside what the revert would write, and the choice between them.
export function RevertConflict({ revert }: { revert: Revert }) {
  const { conflict } = revert.words;
  return (
    <ConflictPanel
      section={revert.section}
      conflicts={revert.conflicts}
      lead={conflict.lead}
      keepHint={conflict.keepHint}
      takeHint={conflict.takeHint}
      busy={revert.busy}
      onKeepMine={revert.revert}
      onTakeTheirs={revert.takeTheirs}
    />
  );
}
