import { type KeyboardEvent, type RefObject } from 'react';
import { canSend, keyAction } from '#/widgets/assistant-panel/services/composer';

export interface ComposerState {
  sendable: boolean;
  submit: () => void;
  stop: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

// The message being written. It keeps the focus while an answer streams, so a
// person can go on typing the next question, and takes it back after Stop.
export function useComposer(options: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (text: string) => void;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}): ComposerState {
  const { text, setText } = options;
  const sendable = canSend(text, options.running);
  const submit = (): void => {
    if (!sendable) return;
    options.onSend(text);
    setText('');
  };
  return {
    sendable,
    submit,
    stop: () => {
      options.onStop();
      options.inputRef.current?.focus();
    },
    onKeyDown: (event) => {
      if (keyAction(event.nativeEvent) !== 'send') return;
      event.preventDefault();
      submit();
    },
  };
}
