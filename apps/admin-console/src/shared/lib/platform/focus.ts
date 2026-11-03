// True when nothing holds the page's focus, as when the control that had it has just gone.
export function focusIsLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body;
}
