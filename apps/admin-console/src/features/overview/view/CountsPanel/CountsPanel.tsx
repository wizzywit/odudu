import { Link, VisuallyHidden } from 'react-aria-components';
import { countAgainLabel, limitText, type CountTile } from '#/features/overview/service';
import { Panel } from '#/features/overview/view/Panel';
import { Button } from '#/shared/view/Button';
import { Count } from '#/shared/view/Count';
import { SkeletonBar } from '#/shared/view/Skeleton';
import styles from '#/features/overview/view/CountsPanel/CountsPanel.module.css';

function Figure({ tile }: { tile: CountTile }) {
  const { count } = tile;
  switch (count.status) {
    case 'off':
    case 'loading':
      return (
        <span className={styles.counting}>
          <SkeletonBar size="label" />
          <VisuallyHidden>Counting…</VisuallyHidden>
        </span>
      );
    case 'needs':
      return (
        <span role="note" className={styles.quiet}>
          Needs the <code>{count.capability}</code> capability.
        </span>
      );
    case 'failed':
      return (
        <span className={styles.failed}>
          Could not be counted
          <Button
            size="small"
            variant="quiet"
            onPress={count.retry}
            aria-label={countAgainLabel(tile.noun.other)}
          >
            Try again
          </Button>
        </span>
      );
    case 'ready':
      return (
        <span className={styles.figure}>
          <Count count={count.data.count} capped={count.data.capped} noun={tile.noun} />
          {tile.limit === undefined ? null : (
            <span className={styles.quiet}>{limitText(tile.limit)}</span>
          )}
        </span>
      );
  }
}

export function CountsPanel({ tiles }: { tiles: readonly CountTile[] }) {
  return (
    <Panel title="Counts">
      <ul className={styles.tiles}>
        {tiles.map((tile) => (
          <li key={tile.id} className={styles.tile}>
            <Link href={tile.href} className={styles.link ?? ''}>
              {tile.label}
            </Link>
            <Figure tile={tile} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
