import { useId } from 'react';
import { describeValue, type Conflict } from '#/shared/service/conflict.ts';
import type { ConflictSource } from '#/shared/service/sectionSave.ts';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/ConflictPanel.module.css';

function shown(conflict: Conflict, value: unknown): string {
  if (conflict.secret) return 'hidden';
  return (conflict.describe ?? describeValue)(value);
}

const LEAD: Record<ConflictSource, string> = {
  changed: 'Somebody else saved these fields while you were editing them. Nothing has been merged.',
  kept: 'The record changed after these edits were kept, so each is shown beside what it holds now. Nothing has been merged.',
};

// Nothing merges on its own: the person sees both values and chooses, for
// the section as a whole, which of them the record keeps.
export function ConflictPanel({
  section,
  conflicts,
  source = 'changed',
  busy = false,
  onKeepMine,
  onTakeTheirs,
}: {
  section: string;
  readonly conflicts: readonly Conflict[];
  source?: ConflictSource;
  busy?: boolean;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const caption = useId();
  const keep = useId();
  const take = useId();
  if (conflicts.length === 0) return null;
  return (
    <div className={styles.panel}>
      <p id={caption} className={styles.title}>
        Changed in {section} since you opened it
      </p>
      <p className={styles.lead}>{LEAD[source]}</p>
      <table aria-labelledby={caption} className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Theirs, saved now</th>
            <th scope="col">Yours, not saved</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((conflict) => (
            <tr key={conflict.field}>
              <th scope="row">{conflict.label}</th>
              <td>{shown(conflict, conflict.theirs)}</td>
              <td>{shown(conflict, conflict.yours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actions}>
        <Button
          variant="primary"
          isDisabled={busy}
          onPress={onKeepMine}
          aria-label={`Keep mine in ${section}`}
          aria-describedby={keep}
        >
          Keep mine
        </Button>
        <span id={keep} className={styles.hint}>
          Saves your values over theirs.
        </span>
        <Button
          isDisabled={busy}
          onPress={onTakeTheirs}
          aria-label={`Take theirs in ${section}`}
          aria-describedby={take}
        >
          Take theirs
        </Button>
        <span id={take} className={styles.hint}>
          Drops your edits to these fields and keeps the rest.
        </span>
      </div>
    </div>
  );
}
