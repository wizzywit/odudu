import { useId, useState } from 'react';
import {
  advance,
  canAdvance,
  MAX_PAGES,
  retreat,
  type CursorTrail,
} from '#/shared/service/cursorTrail.ts';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/Pager.module.css';

export function Pager({
  label,
  trail,
  next,
  onTrailChange,
  onLoadMore,
  loadingMore = false,
}: {
  readonly label: string;
  readonly trail: CursorTrail;
  readonly next: string | null;
  readonly onTrailChange: (trail: CursorTrail) => void;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
}) {
  const noun = label.toLowerCase();
  const limitReason = useId();
  const atLimit = next !== null && !canAdvance(trail, next);
  // Once more rows are appended the list spans pages, so no single number fits.
  const [appendedOn, setAppendedOn] = useState<string | null>(null);
  const appended = appendedOn === trail.join(' ');
  return (
    <nav aria-label={`Pages of ${noun}`} className={styles.pager}>
      {onLoadMore === undefined || next === null ? null : (
        <Button
          isDisabled={loadingMore}
          onPress={() => {
            setAppendedOn(trail.join(' '));
            onLoadMore();
          }}
        >
          {loadingMore ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      )}
      <div className={styles.steps}>
        <Button
          size="small"
          variant="quiet"
          aria-label="Previous page"
          isDisabled={trail.length === 0}
          onPress={() => {
            onTrailChange(retreat(trail));
          }}
        >
          Previous
        </Button>
        {appended ? null : (
          <span className={styles.page}>{`Page ${String(trail.length + 1)}`}</span>
        )}
        <Button
          size="small"
          variant="quiet"
          aria-label="Next page"
          isDisabled={next === null || atLimit}
          {...(atLimit ? { 'aria-describedby': limitReason } : {})}
          onPress={() => {
            if (next !== null) onTrailChange(advance(trail, next));
          }}
        >
          Next
        </Button>
      </div>
      {atLimit ? (
        <p id={limitReason} className={styles.limit}>
          {`Paged as far as ${String(MAX_PAGES)} pages. Narrow the list to see further.`}
        </p>
      ) : null}
    </nav>
  );
}
