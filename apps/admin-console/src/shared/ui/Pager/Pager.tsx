import { useId, useState } from 'react';
import { advance, canAdvance, retreat, type CursorTrail } from '#/shared/lib/services/cursorTrail';
import { Button } from '#/shared/ui/Button';
import { LoadMore } from '#/shared/ui/LoadMore';
import styles from '#/shared/ui/Pager/Pager.module.css';

// What a paged list gives its pager. Without `loadMore` there is no button
// to append the next page in place.
export interface PagedList {
  trail: CursorTrail;
  next: string | null;
  setTrail: (trail: CursorTrail) => void;
  loadMore?: () => void;
  loadingMore?: boolean;
  loadLimited?: boolean;
}

export function Pager({ label, list }: { label: string; list: PagedList }) {
  const { trail, next, setTrail, loadMore, loadingMore = false, loadLimited = false } = list;
  const noun = label.toLowerCase();
  const limitReason = useId();
  const atLimit = next !== null && !canAdvance(trail, next);
  // Once more rows are appended the list spans pages, so no single number fits.
  const [appendedOn, setAppendedOn] = useState<string | null>(null);
  const appended = appendedOn === trail.join(' ');
  return (
    <nav aria-label={`Pages of ${noun}`} className={styles.pager}>
      {loadMore === undefined || next === null ? null : (
        <LoadMore
          noun={noun}
          loading={loadingMore}
          limited={loadLimited}
          onPress={() => {
            setAppendedOn(trail.join(' '));
            loadMore();
          }}
        />
      )}
      <div className={styles.steps}>
        <Button
          size="small"
          variant="quiet"
          aria-label="Previous page"
          isDisabled={trail.length === 0}
          onPress={() => {
            setTrail(retreat(trail));
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
            if (next !== null) setTrail(advance(trail, next));
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
