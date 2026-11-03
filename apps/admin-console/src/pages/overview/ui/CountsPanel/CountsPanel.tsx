import { Link, VisuallyHidden } from 'react-aria-components';
import type { OverviewWords } from '#/pages/overview/services/overviewWords';
import { type CountTile } from '#/pages/overview/services/tiles';
import { Panel } from '#/pages/overview/ui/Panel';
import { Button } from '#/shared/ui/Button';
import { Count } from '#/shared/ui/Count';
import { SkeletonBar } from '#/shared/ui/Skeleton';
import styles from '#/pages/overview/ui/CountsPanel/CountsPanel.module.css';

function Figure({ tile, words }: { tile: CountTile; words: OverviewWords['counts'] }) {
  const { count } = tile;
  switch (count.status) {
    case 'off':
    case 'loading':
      return (
        <span className={styles.counting}>
          <SkeletonBar size="label" />
          <VisuallyHidden>{words.counting}</VisuallyHidden>
        </span>
      );
    case 'needs':
      return (
        <span role="note" className={styles.quiet}>
          {words.needsBefore}
          <code>{count.capability}</code>
          {words.needsAfter}
        </span>
      );
    case 'failed':
      return (
        <span className={styles.failed}>
          {words.failed}
          <Button size="small" variant="quiet" onPress={count.retry} aria-label={tile.againLabel}>
            {words.retry}
          </Button>
        </span>
      );
    case 'ready':
      return (
        <span className={styles.figure}>
          <Count count={count.data.count} capped={count.data.capped} noun={tile.noun} />
          {tile.allowance === undefined ? null : (
            <span className={styles.quiet}>{tile.allowance}</span>
          )}
        </span>
      );
  }
}

export function CountsPanel({
  tiles,
  words,
}: {
  tiles: readonly CountTile[];
  words: OverviewWords['counts'];
}) {
  return (
    <Panel title={words.title}>
      <ul className={styles.tiles}>
        {tiles.map((tile) => (
          <li key={tile.id} className={styles.tile}>
            <Link href={tile.href} className={styles.link ?? ''}>
              {tile.label}
            </Link>
            <Figure tile={tile} words={words} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
