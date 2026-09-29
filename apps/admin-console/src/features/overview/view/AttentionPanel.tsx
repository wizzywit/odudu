import { Link } from 'react-aria-components';
import type { AttentionState } from '#/features/overview/service.ts';
import { Panel } from '#/features/overview/view/Panel.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { ListSkeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/features/overview/view/AttentionPanel.module.css';

export function AttentionPanel({ attention }: { attention: AttentionState }) {
  const { status, items, unchecked, failed } = attention;
  const clear = status === 'ready' && items.length === 0 && unchecked.length === 0 && !failed;
  return (
    <Panel title="Needs attention">
      {status === 'checking' ? (
        <ListSkeleton label="Checking what needs attention" items={2} />
      ) : null}
      {items.length > 0 ? (
        <ul aria-label="Needs attention" className={styles.items}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <p className={styles.title}>{item.title}</p>
              <p className={styles.detail}>{item.detail}</p>
              <Link href={item.href} className={styles.link ?? ''}>
                {`Open ${item.place}`}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {clear ? <p className={styles.clear}>Nothing needs attention.</p> : null}
      {unchecked.length > 0 ? (
        <p role="note" className={styles.note}>
          {'Some checks need a capability you do not hold: '}
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
          <p>Some checks could not run.</p>
          <Button size="small" onPress={attention.retry}>
            Check again
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
