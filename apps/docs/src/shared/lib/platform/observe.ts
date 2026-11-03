export type IntersectionConstructor = typeof IntersectionObserver;

// Calls `onEntry` for every report on any of `targets`; the returned function stops watching.
export function observeIntersections(
  targets: Element[],
  options: IntersectionObserverInit,
  onEntry: (target: Element, intersecting: boolean) => void,
  Observer: IntersectionConstructor = IntersectionObserver,
): () => void {
  const observer = new Observer((entries) => {
    for (const entry of entries) onEntry(entry.target, entry.isIntersecting);
  }, options);
  for (const target of targets) observer.observe(target);
  return () => {
    observer.disconnect();
  };
}

// Reports whether one element is in view; a no-op where the browser has no
// observer, and nothing to stop where there is no element yet.
export function watchVisible(
  target: Element | null,
  options: IntersectionObserverInit,
  onChange: (visible: boolean) => void,
): (() => void) | undefined {
  if (target === null) return undefined;
  if (!canObserve()) return () => undefined;
  return observeIntersections([target], options, (_target, visible) => {
    onChange(visible);
  });
}

export function canObserve(): boolean {
  return typeof IntersectionObserver !== 'undefined';
}
