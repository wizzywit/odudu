export interface Caret {
  // 0-based, and the column counts a tab as its width.
  line: number;
  column: number;
}

// Where the caret `at` is in `text`, as a line and a column.
export function caretAt(text: string, at: number, tabWidth: number): Caret {
  let line = 0;
  let column = 0;
  for (let index = 0; index < at && index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x0a) {
      line += 1;
      column = 0;
    } else {
      column += code === 0x09 ? tabWidth : 1;
    }
  }
  return { line, column };
}

export interface Metrics {
  lineHeight: number;
  charWidth: number;
  // Where line 0, column 0 is drawn, from the scrolled content's own corner.
  originX: number;
  originY: number;
  // The width of what covers the left of the view and may hide the caret.
  inset: number;
}

export interface Viewport {
  scrollTop: number;
  scrollLeft: number;
  clientHeight: number;
  clientWidth: number;
}

export interface Scroll {
  // The scroll position that shows the caret, or null where it already shows.
  top: number | null;
  left: number | null;
}

// A line or a few characters of the text around the caret stay in view with it.
const MARGIN_LINES = 1;
const MARGIN_CHARS = 4;

function along(
  at: number,
  size: number,
  start: number,
  length: number,
  margin: number,
  inset: number,
): number | null {
  if (at - margin < start + inset) return Math.max(0, at - margin - inset);
  if (at + size + margin > start + length) return at + size + margin - length;
  return null;
}

// The scroll that brings the caret into view, for a view that does not scroll
// to a selection set from code.
export function scrollTarget(caret: Caret, metrics: Metrics, view: Viewport): Scroll {
  const x = metrics.originX + caret.column * metrics.charWidth;
  const y = metrics.originY + caret.line * metrics.lineHeight;
  return {
    top: along(
      y,
      metrics.lineHeight,
      view.scrollTop,
      view.clientHeight,
      MARGIN_LINES * metrics.lineHeight,
      0,
    ),
    left: along(
      x,
      metrics.charWidth,
      view.scrollLeft,
      view.clientWidth,
      MARGIN_CHARS * metrics.charWidth,
      metrics.inset,
    ),
  };
}
