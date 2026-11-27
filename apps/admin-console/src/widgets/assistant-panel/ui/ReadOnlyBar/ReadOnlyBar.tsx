import { Button } from '#/shared/ui/Button';
import { Note } from '#/shared/ui/Note';
import type { ReadOnlyReason } from '#/widgets/assistant-panel/types/conversations';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import styles from '#/widgets/assistant-panel/ui/ReadOnlyBar/ReadOnlyBar.module.css';

// Where the composer is while the conversation takes no message: it says why,
// and offers the one thing that carries on. A hidden conversation is
// restored; one whose sign-in ended is left for a new one.
export function ReadOnlyBar({
  reason,
  words,
  onRestore,
  onStartNew,
}: {
  reason: ReadOnlyReason;
  words: PanelWords;
  onRestore: () => void;
  onStartNew: () => void;
}) {
  const archived = reason === 'archived';
  return (
    <div className={styles.bar}>
      <Note>{archived ? words.archivedNote : words.endedNote}</Note>
      <Button variant="primary" onPress={archived ? onRestore : onStartNew}>
        {archived ? words.archivedAction : words.endedAction}
      </Button>
    </div>
  );
}
