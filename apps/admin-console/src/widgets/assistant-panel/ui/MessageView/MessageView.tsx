import { StatusTag } from '#/shared/ui/StatusTag';
import type { PanelMessage } from '#/widgets/assistant-panel/types/chat';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { MessageText } from '#/widgets/assistant-panel/ui/MessageText';
import styles from '#/widgets/assistant-panel/ui/MessageView/MessageView.module.css';

// One message: a person's words as the text they typed, or the assistant's
// answer as safe markdown with its steps between. `busy` is the answer still
// being written, which a screen reader is told by the message and not by its
// words.
export function MessageView({
  message,
  busy,
  words,
}: {
  message: PanelMessage;
  busy: boolean;
  words: PanelWords;
}) {
  const mine = message.role === 'user';
  const who = mine ? words.you : words.assistant;
  return (
    <article
      className={styles.message}
      data-role={message.role}
      aria-busy={busy ? true : undefined}
      aria-label={who}
    >
      <p className={styles.who} aria-hidden="true">
        {who}
      </p>
      {mine ? <p className={styles.typed}>{message.typed}</p> : null}
      {mine
        ? null
        : message.blocks.map((block, index) =>
            block.kind === 'text' ? (
              <MessageText
                key={`${String(index)}:text`}
                settled={block.settled}
                open={block.open}
                tableLabel={words.tableLabel}
              />
            ) : (
              <ul
                key={`${String(index)}:steps`}
                className={styles.steps}
                aria-label={words.stepsLabel}
              >
                {block.steps.map((step) => (
                  <li key={step.id} className={styles.step}>
                    <StatusTag tone={step.tone}>{step.label}</StatusTag>
                    <span className={styles.stepText}>{step.text}</span>
                  </li>
                ))}
              </ul>
            ),
          )}
    </article>
  );
}
