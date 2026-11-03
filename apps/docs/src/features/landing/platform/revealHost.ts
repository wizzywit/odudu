import {
  observeIntersections,
  type IntersectionConstructor,
} from '@site/src/shared/lib/platform/observe';
import {
  startReveal,
  REVEAL_MARGIN,
  type RevealHost,
  type RevealItem,
} from '@site/src/features/landing/services/reveal';

// The parts of a browser the reveal needs, handed in by whoever runs it.
export interface RevealEnv {
  document: Pick<Document, 'querySelectorAll'>;
  window: Pick<
    Window,
    | 'innerHeight'
    | 'addEventListener'
    | 'removeEventListener'
    | 'requestAnimationFrame'
    | 'cancelAnimationFrame'
  >;
  Observer: IntersectionConstructor;
}

interface Marked extends RevealItem {
  element: Element;
}

// The reveal over a page's `[data-reveal]` elements, held back with `data-pending`.
export function startDomReveal(env: RevealEnv): (() => void) | undefined {
  const host: RevealHost<Marked> = {
    items: () =>
      [...env.document.querySelectorAll('[data-reveal]')].map((element) => ({
        element,
        top: () => element.getBoundingClientRect().top,
        hold: () => {
          element.setAttribute('data-pending', '');
        },
        release: () => {
          element.removeAttribute('data-pending');
        },
      })),
    viewport: () => env.window.innerHeight,
    watch: (items, seen) =>
      observeIntersections(
        items.map((item) => item.element),
        { rootMargin: REVEAL_MARGIN },
        (target, intersecting) => {
          const item = items.find((candidate) => candidate.element === target);
          if (intersecting && item !== undefined) seen(item);
        },
        env.Observer,
      ),
    scrolled: (handler) => {
      env.window.addEventListener('scroll', handler, { passive: true });
      return () => {
        env.window.removeEventListener('scroll', handler);
      };
    },
    frame: (run) => {
      const handle = env.window.requestAnimationFrame(run);
      return () => {
        env.window.cancelAnimationFrame(handle);
      };
    },
  };
  return startReveal(host);
}

// The reveal over the page the browser is showing.
export function startPageReveal(): (() => void) | undefined {
  return startDomReveal({ document, window, Observer: IntersectionObserver });
}
