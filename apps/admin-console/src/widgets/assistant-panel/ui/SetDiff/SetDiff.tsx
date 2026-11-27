import { StatusTag } from '#/shared/ui/StatusTag';
import type { SetSide } from '#/widgets/assistant-panel/types/approvals';
import styles from '#/widgets/assistant-panel/ui/SetDiff/SetDiff.module.css';

function Side({ side, tone }: { side: SetSide; tone: 'active' | 'danger' }) {
  return (
    <section className={styles.side} data-side={tone === 'active' ? 'added' : 'removed'}>
      <h5 className={styles.heading}>
        <StatusTag tone={tone}>{side.heading}</StatusTag>
      </h5>
      {side.names.length === 0 ? (
        <p className={styles.empty}>{side.empty}</p>
      ) : (
        <ul className={styles.names}>
          {side.names.map((name) => (
            <li key={name} className={styles.name}>
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// What a change that replaces a list adds and what it removes, every name whole
// and under a heading that says which, so colour is never the only thing that does.
// A server refuses a change whose names do not fit, so none is cut here.
export function SetDiff({
  set,
  label,
}: {
  set: { added: SetSide; removed: SetSide };
  label: string;
}) {
  return (
    <div className={styles.set} role="group" aria-label={label}>
      <Side side={set.added} tone="active" />
      <Side side={set.removed} tone="danger" />
    </div>
  );
}
