import { useEffect, type RefObject } from 'react';
import { revealOffset } from '#/shared/service/reveal';

// Keeps the selected item of a row that scrolls sideways in view, as when
// the row is narrower than its items and the selection moves or is restored.
export function useRevealSelected(
  row: RefObject<HTMLElement | null>,
  selected: string | undefined,
): void {
  useEffect(() => {
    const list = row.current;
    const item = list?.querySelector('[aria-selected="true"]');
    if (list === null || list === undefined || item === null || item === undefined) return;
    const view = list.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    const to = revealOffset(
      { start: box.left, size: box.width },
      { start: view.left, size: view.width, scrolled: list.scrollLeft },
    );
    if (to !== null) list.scrollTo({ left: to });
  }, [row, selected]);
}
