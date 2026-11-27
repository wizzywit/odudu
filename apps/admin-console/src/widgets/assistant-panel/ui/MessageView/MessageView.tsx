import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { PanelMessage } from '#/widgets/assistant-panel/types/chat';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { ActivityFeed } from '#/widgets/assistant-panel/ui/ActivityFeed';
import { MessageText } from '#/widgets/assistant-panel/ui/MessageText';
import styles from '#/widgets/assistant-panel/ui/MessageView/MessageView.module.css';

// One message: a person's words as the text they typed, or the assistant's
// answer as safe markdown with its steps between. `busy` is the answer still
// being written, which a screen reader is told by the message and not by its
// words.
export function MessageView({
  message,
  busy,
  entries,
  username,
  actingIn,
  words,
  onDecide,
}: {
  message: PanelMessage;
  busy: boolean;
  // The changes the conversation waits on or has just decided, whose cards are
  // drawn under the step that proposed them.
  entries: readonly Entry[];
  username: string;
  actingIn: string | null;
  words: PanelWords;
  onDecide: (entry: Entry, approve: boolean) => void;
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
              <ActivityFeed
                key={`${String(index)}:steps`}
                steps={block.steps}
                live={busy || block.steps.some((step) => step.state === 'waiting')}
                entries={entries}
                username={username}
                actingIn={actingIn}
                words={words}
                onDecide={onDecide}
              />
            ),
          )}
    </article>
  );
}
