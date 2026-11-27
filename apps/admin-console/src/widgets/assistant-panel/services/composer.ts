import { MESSAGE_TEXT_MAX } from '@odudu/contracts/admin';

export const COMPOSER_MAX = MESSAGE_TEXT_MAX;

export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  // An Enter that confirms an input method's composition is not a send.
  isComposing: boolean;
}

export function keyAction(event: ComposerKey): 'send' | 'newline' | 'type' {
  if (event.key !== 'Enter' || event.isComposing) return 'type';
  return event.shiftKey ? 'newline' : 'send';
}

export function messageToSend(text: string): string {
  return text.trim();
}

export function canSend(text: string, running: boolean): boolean {
  const message = messageToSend(text);
  return !running && message.length > 0 && message.length <= COMPOSER_MAX;
}
