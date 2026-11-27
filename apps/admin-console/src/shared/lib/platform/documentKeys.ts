// Calls `onKey` for every key pressed anywhere on the page, until the returned
// function is called.
export function listenToKeys(onKey: (event: KeyboardEvent) => void): () => void {
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
  };
}

// Gives the focus back to `element`; where it cannot take it (gone from the
// page, or hidden at this width) the page's main content takes it instead, so
// it is never lost to the body.
export function returnFocusTo(element: HTMLElement | null): void {
  element?.focus();
  if (element !== null && document.activeElement === element) return;
  document.getElementById('main')?.focus();
}

// The element that holds the focus; the page itself when no control does.
export function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
