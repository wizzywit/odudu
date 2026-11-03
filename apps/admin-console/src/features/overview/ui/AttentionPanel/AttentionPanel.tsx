import { Link } from 'react-aria-components';
import type { AttentionState } from '#/features/overview/services/state';
import type { OverviewWords } from '#/features/overview/services/overviewWords';
import { Panel } from '#/features/overview/ui/Panel';
import { Button } from '#/shared/ui/Button';
import { ListSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/features/overview/ui/AttentionPanel/AttentionPanel.module.css';

export function AttentionPanel({
  attention,
  words,
}: {
  attention: AttentionState;
  words: OverviewWords['attention'];
}) {
  const { status, items, unchecked, failed, clear } = attention;
  return (
    <Panel title={words.title}>
      {status === 'checking' ? <ListSkeleton label={words.checking} items={2} /> : null}
      {items.length > 0 ? (
        <ul aria-label={words.title} className={styles.items}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <p className={styles.title}>{item.title}</p>
              <p className={styles.detail}>{item.detail}</p>
              <Link href={item.href} className={styles.link ?? ''}>
                {item.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {clear ? (
        <p className={styles.clear}>
          <span aria-hidden="true" className={styles.check}>
            ✓
          </span>
          {words.clear}
        </p>
      ) : null}
      {unchecked.length > 0 ? (
        <p role="note" className={styles.note}>
          {words.uncheckedLead}
          {unchecked.map((capability, index) => (
            <span key={capability}>
              {index > 0 ? ', ' : null}
              <code>{capability}</code>
            </span>
          ))}
          .
        </p>
      ) : null}
      {failed ? (
        <div className={styles.failed}>
          <p>{words.failed}</p>
          <Button size="small" onPress={attention.retry}>
            {words.retry}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
