import { useEffect, useRef, type RefObject } from 'react';
import { nearBottom } from '#/widgets/assistant-panel/services/scroll';

// A log that stays at its end as it grows, until the person scrolls up to
// read, and follows again once they are back at the bottom. `size` is any
// number that changes when the log's content does.
export function usePinnedScroll(size: number): {
  logRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
} {
  const logRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const log = logRef.current;
    if (log !== null && following.current) log.scrollTop = log.scrollHeight;
  }, [size]);
  return {
    logRef,
    onScroll: () => {
      const log = logRef.current;
      if (log !== null) following.current = nearBottom(log);
    },
  };
}
