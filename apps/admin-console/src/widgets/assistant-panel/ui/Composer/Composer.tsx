import { useRef } from 'react';
import { Button } from '#/shared/ui/Button';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { useComposer } from '#/widgets/assistant-panel/use-cases/useComposer';
import styles from '#/widgets/assistant-panel/ui/Composer/Composer.module.css';

// Where the next message is written. Stop takes the place of Send for as long
// as an answer is being written, and is always one Tab from the field.
export function Composer({
  running,
  blocked,
  contextLabel,
  draft,
  onDraft,
  words,
  maxLength,
  onSend,
  onStop,
}: {
  running: boolean;
  // Nothing can be sent: the conversation waits for a decision.
  blocked: boolean;
  // Where the administrator is, which goes with the first message.
  contextLabel: string;
  // What is being typed, held by the panel so putting it away keeps it.
  draft: string;
  onDraft: (text: string) => void;
  words: PanelWords;
  // The most the server takes in one message.
  maxLength: number;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composer = useComposer({
    inputRef,
    text: draft,
    setText: onDraft,
    running: running || blocked,
    onSend,
    onStop,
  });
  const hintId = 'assistant-composer-hint';
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        composer.submit();
      }}
    >
      <p className={styles.context}>
        <span className={styles.contextLabel}>{words.contextLabel}</span>
        <span className={styles.chip}>{contextLabel}</span>
      </p>
      <textarea
        ref={inputRef}
        className={styles.input}
        aria-label={words.composerLabel}
        aria-describedby={hintId}
        placeholder={words.composerPlaceholder}
        rows={2}
        maxLength={maxLength}
        disabled={blocked}
        value={draft}
        onChange={(event) => {
          onDraft(event.target.value);
        }}
        onKeyDown={composer.onKeyDown}
      />
      <div className={styles.row}>
        <p id={hintId} className={styles.hint}>
          {words.composerHint}
        </p>
        <span className={styles.action}>
          {running ? (
            <Button variant="secondary" size="small" onPress={composer.stop}>
              {words.stop}
            </Button>
          ) : (
            <Button variant="primary" size="small" type="submit" isDisabled={!composer.sendable}>
              {words.send}
            </Button>
          )}
        </span>
      </div>
    </form>
  );
}
