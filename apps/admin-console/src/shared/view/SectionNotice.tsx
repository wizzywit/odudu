import { VisuallyHidden } from 'react-aria-components';
import type { Conflict } from '#/shared/service/conflict.ts';
import type { ConflictSource, SaveStatus } from '#/shared/service/sectionSave.ts';
import { ConflictPanel } from '#/shared/view/ConflictPanel.tsx';
import styles from '#/shared/view/SectionNotice.module.css';

function summary(
  section: string,
  status: SaveStatus,
  conflicts: readonly Conflict[],
  source: ConflictSource,
  message: string | null,
): string {
  const labels = conflicts.map((conflict) => conflict.label).join(', ');
  switch (status) {
    case 'conflict':
      return source === 'kept'
        ? `${section} changed since these edits were kept: ${labels}. Compare them, then keep yours or take theirs.`
        : `${labels} in ${section} changed elsewhere since you opened it. Keep yours or take theirs.`;
    case 'stale':
      return `${section} changed elsewhere since you opened it. None of your edits was touched, and they are kept on the new version: save again to apply them.`;
    case 'refused':
      return message ?? '';
    default:
      return '';
  }
}

// What a section's last save said beyond its fields, for the section's
// notice slot. Only the one-line summary is announced; the comparison
// beside it is read when the person reaches it.
export function SectionNotice({
  section,
  status,
  conflicts,
  conflictSource,
  message,
  busy,
  onKeepMine,
  onTakeTheirs,
}: {
  section: string;
  status: SaveStatus;
  readonly conflicts: readonly Conflict[];
  conflictSource: ConflictSource;
  message: string | null;
  busy: boolean;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const said = summary(section, status, conflicts, conflictSource, message);
  return (
    <div className={styles.notice}>
      <p
        role="status"
        className={styles.summary}
        data-shown={(status !== 'conflict' && said !== '') || undefined}
      >
        {status === 'conflict' ? <VisuallyHidden elementType="span">{said}</VisuallyHidden> : said}
      </p>
      <ConflictPanel
        section={section}
        conflicts={conflicts}
        source={conflictSource}
        busy={busy}
        onKeepMine={onKeepMine}
        onTakeTheirs={onTakeTheirs}
      />
    </div>
  );
}
