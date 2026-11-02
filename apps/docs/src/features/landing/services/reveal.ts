// Content below the first screen starts low and transparent and settles as it
// comes into view. The decisions and the order of things are here; the browser
// the page runs in is handed in, so nothing in this file reads one.

export const REVEAL_MARGIN = '0px 0px -8% 0px';
const SWEEP_SHARE = 0.92;

// Only what is not yet on screen at the start is held back.
export function belowFold(top: number, viewport: number): boolean {
  return top >= viewport;
}

// An item that has come up into the screen, or been scrolled past in one jump.
export function reached(top: number, viewport: number): boolean {
  return top < viewport * SWEEP_SHARE;
}

export interface RevealItem {
  top: () => number;
  // Puts the item low and transparent, and lets it settle again.
  hold: () => void;
  release: () => void;
}

export interface RevealHost<T extends RevealItem> {
  items: () => T[];
  viewport: () => number;
  // Calls `seen` for an item that enters the screen; returns the function that stops watching.
  watch: (items: T[], seen: (item: T) => void) => () => void;
  scrolled: (handler: () => void) => () => void;
  frame: (run: () => void) => () => void;
}

// Holds back what is below the first screen and releases each item as it is
// reached. Returns the function that puts the page back, or nothing where the
// browser could not do it, with the page as it was.
export function startReveal<T extends RevealItem>(host: RevealHost<T>): (() => void) | undefined {
  const pending = host.items().filter((item) => belowFold(item.top(), host.viewport()));
  const held = new Set<T>();
  const stops: (() => void)[] = [];
  let cancelFrame: (() => void) | undefined;
  const release = (item: T): void => {
    if (held.delete(item)) item.release();
  };
  const sweep = (): void => {
    cancelFrame = undefined;
    for (const item of [...held]) {
      if (reached(item.top(), host.viewport())) release(item);
    }
  };
  const putBack = (): void => {
    for (const stop of stops) stop();
    cancelFrame?.();
    for (const item of [...held]) release(item);
  };
  try {
    for (const item of pending) {
      held.add(item);
      item.hold();
    }
    stops.push(host.watch(pending, release));
    // An observer reports changes only, so an item scrolled past in one jump is released here.
    stops.push(
      host.scrolled(() => {
        cancelFrame ??= host.frame(sweep);
      }),
    );
  } catch {
    putBack();
    return undefined;
  }
  return putBack;
}

// What the page marks itself with once the reveal has taken hold, for the stylesheet.
export function motionMark(active: boolean): 'ok' | undefined {
  return active ? 'ok' : undefined;
}
