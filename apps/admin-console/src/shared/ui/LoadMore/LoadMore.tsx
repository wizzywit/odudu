import { useRef } from 'react';
import { LOAD_LIMIT_NOTICE } from '#/shared/services/resourceList';
import { useFocusWhen } from '#/shared/use-cases/useFocusWhen';
import { Button } from '#/shared/ui/Button';
import styles from '#/shared/ui/LoadMore/LoadMore.module.css';

// The button that appends the next page to a list already on screen. `compact`
// is the small quiet one a tree or a picker draws inside its own box, and
// `limited` swaps the button for the sentence that says the list is full.
export function LoadMore({
  noun,
  loading,
  onPress,
  compact = false,
  limited,
}: {
  noun: string;
  loading: boolean;
  onPress: () => void;
  compact?: boolean;
  limited: boolean;
}) {
  const notice = useRef<HTMLParagraphElement>(null);
  useFocusWhen(notice, limited);
  return (
    <>
      {limited ? null : (
        <Button
          {...(compact ? { size: 'small', variant: 'quiet' } : {})}
          isDisabled={loading}
          onPress={onPress}
        >
          {loading ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      )}
      <p ref={notice} role="status" tabIndex={-1} className={styles.limit}>
        {limited ? LOAD_LIMIT_NOTICE : null}
      </p>
    </>
  );
}

// A page after the first failed: the rows already shown stay, and pressing
// the button again is the retry.
export function LoadMoreFailed({ noun }: { noun: string }) {
  return (
    <p role="alert" className={styles.failed}>
      {`More ${noun} could not be loaded. Load more tries again.`}
    </p>
  );
}
