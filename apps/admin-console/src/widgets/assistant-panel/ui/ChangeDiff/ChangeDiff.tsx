import { StatusTag, type StatusTone } from '#/shared/ui/StatusTag';
import type { DiffRow } from '#/widgets/assistant-panel/types/approvals';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import styles from '#/widgets/assistant-panel/ui/ChangeDiff/ChangeDiff.module.css';

const TONES: Readonly<Record<DiffRow['change'], StatusTone>> = {
  added: 'active',
  removed: 'danger',
  changed: 'warning',
  same: 'neutral',
};

function changeWord(change: DiffRow['change'], words: PanelWords): string {
  switch (change) {
    case 'added':
      return words.changeAdded;
    case 'removed':
      return words.changeRemoved;
    case 'changed':
      return words.changeChanged;
    case 'same':
      return words.changeSame;
  }
}

// The exact change, field by field: what each is now beside what it would
// become. Whether a field is added, removed or changed is written as a word on
// the row, so colour is never the only thing that says it. The two sides sit
// side by side where there is room and stack, now above after, where there is not.
export function ChangeDiff({
  rows,
  creating,
  words,
}: {
  rows: readonly DiffRow[];
  // The target does not exist yet, so there is no "now" to show.
  creating: boolean;
  words: PanelWords;
}) {
  return (
    <ul className={styles.rows} aria-label={words.cardChanges}>
      {rows.map((row) => (
        <li key={row.label} className={styles.row} data-change={row.change}>
          <p className={styles.field}>
            <span className={styles.label}>{row.label}</span>
            <StatusTag tone={TONES[row.change]}>{changeWord(row.change, words)}</StatusTag>
          </p>
          <div className={styles.pair}>
            <div className={styles.side} data-side="before">
              <span className={styles.sideLabel}>{words.cardBefore}</span>
              <span className={styles.value}>{creating ? words.cardCreating : row.before}</span>
            </div>
            <div className={styles.side} data-side="after">
              <span className={styles.sideLabel}>{words.cardAfter}</span>
              <span className={styles.value}>{row.after}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
