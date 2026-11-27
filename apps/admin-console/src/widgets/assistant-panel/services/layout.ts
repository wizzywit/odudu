// The shell width, in pixels, from which the panel takes a column of its own.
// The shell's stylesheet asks the same question of the same number; narrower
// than this the panel lies over the page and is a dialog.
export const DOCK_MIN_WIDTH = 1280;

export function docked(shellWidth: number): boolean {
  return shellWidth >= DOCK_MIN_WIDTH;
}
