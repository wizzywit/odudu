import { useState, type KeyboardEvent, type RefObject } from 'react';
import { canSend, keyAction } from '#/widgets/assistant-panel/services/composer';

export interface ComposerState {
  text: string;
  setText: (text: string) => void;
  sendable: boolean;
  submit: () => void;
  stop: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

// The message being written. It keeps the focus while an answer streams, so a
// person can go on typing the next question, and takes it back after Stop.
export function useComposer(options: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}): ComposerState {
  const [text, setText] = useState('');
  const sendable = canSend(text, options.running);
  const submit = (): void => {
    if (!sendable) return;
    options.onSend(text);
    setText('');
  };
  return {
    text,
    setText,
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
