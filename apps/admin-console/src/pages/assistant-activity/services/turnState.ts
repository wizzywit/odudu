import { EVENTS_PAGE } from '#/pages/assistant-activity/services/replayView';

// Which answers a person opened or closed, and how many entries of each they
// asked to see. An answer they did not touch is open only if it is the latest.
export type Opened = Readonly<Record<string, boolean>>;
export type Shown = Readonly<Record<string, number>>;

export function isOpen(opened: Opened, id: string, latest: string | undefined): boolean {
  return opened[id] ?? id === latest;
}

export function toggled(opened: Opened, id: string, open: boolean): Opened {
  return { ...opened, [id]: !open };
}

export function limitOf(shown: Shown, id: string): number {
  return shown[id] ?? EVENTS_PAGE;
}

export function moreShown(shown: Shown, id: string): Shown {
  return { ...shown, [id]: limitOf(shown, id) + EVENTS_PAGE };
}
