import { useState } from 'react';
import { useIdle } from '@site/src/shared/use-cases/useIdle';
import { usePrefersReducedMotion } from '@site/src/shared/use-cases/usePrefersReducedMotion';
import { canRevealOnScroll } from '@site/src/shared/platform/page';
import { useProbe } from '@site/src/shared/use-cases/useProbe';

// Nothing changes until this has confirmed that the browser has an
// IntersectionObserver, motion is allowed and no automation is driving (a
// capture or an audit must see the page as laid out). The work itself is
// fetched once the page is idle.
export function useReveal(): boolean {
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();
  const capable = useProbe(canRevealOnScroll);
  useIdle(capable && !reduced, 200, () => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    import('@site/src/features/landing/platform/revealHost').then(
      ({ startPageReveal }) => {
        if (cancelled) return;
        stop = startPageReveal();
        setActive(stop !== undefined);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  });
  return active;
}
