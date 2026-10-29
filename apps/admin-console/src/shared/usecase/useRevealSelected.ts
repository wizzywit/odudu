import { useEffect, type RefObject } from 'react';
import { revealOffset } from '#/shared/service/reveal';

function reveal(list: HTMLElement): void {
  const item = list.querySelector('[aria-selected="true"]');
  if (item === null) return;
  const view = list.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  const to = revealOffset(
    { start: box.left, size: box.width },
    { start: view.left, size: view.width, scrolled: list.scrollLeft },
  );
  if (to !== null) list.scrollLeft = to;
}

// Keeps the selected item of a row that scrolls sideways in view, as when
// the row is narrower than its items and the selection moves or is restored.
export function useRevealSelected(
  row: RefObject<HTMLElement | null>,
  selected: string | undefined,
): void {
  useEffect(() => {
    if (row.current !== null) reveal(row.current);
  }, [row, selected]);
}
