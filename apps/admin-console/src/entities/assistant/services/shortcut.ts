import type { Platform } from '#/shared/lib/services/platform';

export interface ShortcutEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

// Anything inside a dialog is behind its scrim from the page's point of view:
// the chord belongs to the dialog, and a panel opening beside it is no help.
export function insideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('[role="dialog"], [role="alertdialog"]') !== null
  );
}

// The chord as aria-keyshortcuts names it.
export function shortcutName(platform: Platform): string {
  return platform === 'mac' ? 'Meta+K' : 'Control+K';
}

// The K key, by its label or, on a layout where K is another letter, its place.
function isK(event: ShortcutEvent): boolean {
  return event.key.toLowerCase() === 'k' || event.code === 'KeyK';
}

// Command K on a Mac, Control K elsewhere, with no other modifier, and never
// while a dialog is open or the target sits in one.
export function opensAssistant(event: ShortcutEvent, platform: Platform, paused: boolean): boolean {
  const mod =
    platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return (
    mod &&
    !paused &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented &&
    isK(event) &&
    !insideDialog(event.target)
  );
}

// What the chord does: nothing, open the panel, or move to it when it is open.
export function shortcutOutcome(
  event: ShortcutEvent,
  platform: Platform,
  state: { paused: boolean; open: boolean },
): 'ignore' | 'open' | 'focus' {
  if (!opensAssistant(event, platform, state.paused)) return 'ignore';
  return state.open ? 'focus' : 'open';
}
