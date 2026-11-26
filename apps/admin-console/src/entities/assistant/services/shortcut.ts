import type { Platform } from '#/shared/lib/services/platform';

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

// A text field inside a dialog keeps its keys: the chord belongs to whoever is
// typing there, and a panel opening behind a dialog is no help.
export function typingInDialog(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('[role="dialog"], [role="alertdialog"]') !== null &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null)
  );
}

// The chord as aria-keyshortcuts names it.
export function shortcutName(platform: Platform): string {
  return platform === 'mac' ? 'Meta+K' : 'Control+K';
}

// Command K on a Mac, Control K elsewhere, with no other modifier.
export function opensAssistant(event: ShortcutEvent, platform: Platform): boolean {
  const mod =
    platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return (
    mod &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented &&
    event.key.toLowerCase() === 'k' &&
    !typingInDialog(event.target)
  );
}
