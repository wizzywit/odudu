import type { RefObject } from 'react';
import { QuietSkeletons, Skeleton } from '#/shared/ui/Skeleton';
import type { AssistantMode, PanelMessage } from '#/widgets/assistant-panel/types/chat';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { MessageView } from '#/widgets/assistant-panel/ui/MessageView';
import styles from '#/widgets/assistant-panel/ui/ChatLog/ChatLog.module.css';

function Empty({ mode, words }: { mode: AssistantMode; words: PanelWords }) {
  return (
    <section className={styles.empty} aria-labelledby="assistant-empty-title">
      <h3 id="assistant-empty-title" className={styles.emptyTitle}>
        {words.emptyTitle}
      </h3>
      <p className={styles.emptyText}>{words.emptyText}</p>
      <p className={styles.emptyText}>{mode === 'ask' ? words.emptyAskNote : words.emptyActNote}</p>
    </section>
  );
}

// The conversation as a log: new messages are appended and nothing in it is
// announced as it changes, since the status line says what changed and the
// words of an answer are read by whoever goes to read them.
export function ChatLog({
  messages,
  running,
  loading,
  mode,
  words,
  logRef,
  onScroll,
}: {
  messages: readonly PanelMessage[];
  // An answer is being written: the last message is the one that is.
  running: boolean;
  loading: boolean;
  mode: AssistantMode;
  words: PanelWords;
  logRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const last = messages[messages.length - 1];
  return (
    <div
      ref={logRef}
      role="log"
      aria-live="off"
      aria-label={words.conversationLabel}
      tabIndex={0}
      className={styles.log}
      onScroll={onScroll}
    >
      {loading ? (
        <QuietSkeletons>
          <Skeleton label={words.loadingHistory} lines={5} />
        </QuietSkeletons>
      ) : null}
      {messages.length === 0 && !loading ? <Empty mode={mode} words={words} /> : null}
      {messages.length > 0 ? (
        <ol className={styles.list}>
          {messages.map((message) => (
            <li key={message.id} className={styles.item}>
              <MessageView
                message={message}
                busy={running && message.id === last?.id && message.role === 'assistant'}
                words={words}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
