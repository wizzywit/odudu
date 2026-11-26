// Calls `onKey` for every key pressed anywhere on the page, until the returned
// function is called.
export function listenToKeys(onKey: (event: KeyboardEvent) => void): () => void {
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
  };
}

// The element that holds the focus; the page itself when no control does.
export function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
