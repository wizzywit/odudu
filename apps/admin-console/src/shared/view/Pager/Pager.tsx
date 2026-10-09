import { useId, useState } from 'react';
import { advance, canAdvance, retreat, type CursorTrail } from '#/shared/service/cursorTrail.ts';
import { Button } from '#/shared/view/Button';
import styles from '#/shared/view/Pager/Pager.module.css';

export function Pager({
  label,
  trail,
  next,
  onTrailChange,
  onLoadMore,
  loadingMore = false,
}: {
  label: string;
  trail: CursorTrail;
  next: string | null;
  onTrailChange: (trail: CursorTrail) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
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
          This is as far as the list can page. Narrow it to see further.
        </p>
      ) : null}
    </nav>
  );
}
