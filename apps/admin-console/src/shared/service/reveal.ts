// Where a row of items that scrolls sideways should be scrolled to, so that
// one of them is whole in view with a little of its neighbour beside it.
// Null when it already is, so the row is not moved for nothing.
export function revealOffset(
  item: { start: number; size: number },
  view: { start: number; size: number; scrolled: number },
  margin = 24,
): number | null {
  if (item.start - margin < view.start) {
    return Math.max(0, view.scrolled + item.start - margin - view.start);
  }
  const overshoot = item.start + item.size + margin - (view.start + view.size);
  return overshoot > 0 ? view.scrolled + overshoot : null;
}

// Scrolls a row sideways to an offset `revealOffset` gave.
export function scrollRowTo(row: HTMLElement, offset: number): void {
  row.scrollLeft = offset;
}
