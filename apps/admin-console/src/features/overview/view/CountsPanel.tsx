import { Link } from 'react-aria-components';
import type { CountTile } from '#/features/overview/service.ts';
import { Panel } from '#/features/overview/view/Panel.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { Count } from '#/shared/view/Count.tsx';
import styles from '#/features/overview/view/CountsPanel.module.css';

const NUMBER = new Intl.NumberFormat('en');

function Figure({ tile }: { tile: CountTile }) {
  const { count } = tile;
  switch (count.status) {
    case 'off':
    case 'loading':
      return <span className={styles.quiet}>Counting…</span>;
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
            aria-label={`Count ${tile.noun.other} again`}
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
            <span className={styles.quiet}>{` of ${NUMBER.format(tile.limit)} allowed`}</span>
          )}
        </span>
      );
  }
}

export function CountsPanel({ tiles }: { readonly tiles: readonly CountTile[] }) {
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
