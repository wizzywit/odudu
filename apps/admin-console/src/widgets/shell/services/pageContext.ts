// A shortcut is paused while a dialog is open, the unsaved-changes guard's
// own included.
export function dialogOpen(openDialogs: number, guardAsking: boolean): boolean {
  return openDialogs > 0 || guardAsking;
}

export function pathnameOf(href: string, base: string): string {
  return new URL(href, base).pathname;
}
