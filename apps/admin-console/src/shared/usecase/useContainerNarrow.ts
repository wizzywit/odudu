import { useEffect, useState, type RefObject } from 'react';
import { isNarrow } from '#/shared/service/narrow';

// Whether the container a part sits in is narrow, as the stylesheets' own
// container queries are: the nearest ancestor marked `data-narrow-container`,
// watched as it resizes. Without a container, or a browser that cannot watch
// one, it is not narrow.
export function useContainerNarrow(part: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const container = part.current?.closest('[data-narrow-container]');
    if (container === null || container === undefined || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const measure = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      setNarrow(isNarrow(container.getBoundingClientRect().width, rem));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(container);
    return () => {
      watch.disconnect();
    };
  }, [part]);
  return narrow;
}
