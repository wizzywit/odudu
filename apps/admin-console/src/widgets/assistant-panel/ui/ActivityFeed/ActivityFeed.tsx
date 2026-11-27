import { useId, useState } from 'react';
import { StatusTag } from '#/shared/ui/StatusTag';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { StepLine } from '#/widgets/assistant-panel/types/chat';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { useFeed } from '#/widgets/assistant-panel/use-cases/useFeed';
import { ApprovalItem } from '#/widgets/assistant-panel/ui/ApprovalItem';
import styles from '#/widgets/assistant-panel/ui/ActivityFeed/ActivityFeed.module.css';

function Step({
  step,
  entry,
  username,
  actingIn,
  words,
  onDecide,
}: {
  step: StepLine;
  entry: Entry | undefined;
  username: string;
  // The tenant the changes are made in, when it is not the person's own.
  actingIn: string | null;
  words: PanelWords;
  onDecide: (entry: Entry, approve: boolean) => void;
}) {
  const [raw, setRaw] = useState(false);
  const rawId = useId();
  return (
    <li className={styles.step} data-state={step.state}>
      <div className={styles.line}>
        <StatusTag tone={step.tone}>{step.label}</StatusTag>
        <span className={styles.text}>{step.text}</span>
        {step.duration === null ? null : <span className={styles.duration}>{step.duration}</span>}
        <button
          type="button"
          className={styles.expander}
          aria-expanded={raw}
          aria-controls={raw ? rawId : undefined}
          onClick={() => {
            setRaw(!raw);
          }}
        >
          {raw ? words.stepRawHide : words.stepRaw}
        </button>
      </div>
      {raw ? (
        <pre id={rawId} className={styles.raw} aria-label={words.stepRawLabel} tabIndex={0}>
          {step.raw}
        </pre>
      ) : null}
      {entry === undefined ? null : (
        <ApprovalItem
          entry={entry}
          username={username}
          actingIn={actingIn}
          step={step.state}
          words={words}
          onDecide={onDecide}
        />
      )}
      {entry === undefined && step.outcome !== null ? (
        <p className={styles.outcome}>{step.outcome}</p>
      ) : null}
    </li>
  );
}

// The steps an answer took, one phrase each with its state and time and, on
// request, the call as it was sent. Open while the answer is being written or
// waits for a decision, and put away once it is finished, except for a step
// that failed or was refused and a change that was decided, which stay in view.
export function ActivityFeed({
  steps,
  live,
  entries,
  username,
  actingIn,
  words,
  onDecide,
}: {
  steps: readonly StepLine[];
  // The answer is still being written, or a change waits on the person.
  live: boolean;
  entries: readonly Entry[];
  username: string;
  actingIn: string | null;
  words: PanelWords;
  onDecide: (entry: Entry, approve: boolean) => void;
}) {
  const feed = useFeed(steps, live, entries);
  const listId = useId();
  return (
    <div className={styles.feed}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={feed.open}
        aria-controls={listId}
        onClick={feed.toggle}
      >
        <span aria-hidden="true" className={styles.chevron} data-open={feed.open || undefined} />
        <span>{feed.open ? words.feedHide : words.feedShow}</span>
        <span className={styles.summary}>{feed.summary}</span>
      </button>
      <ul id={listId} className={styles.steps} aria-label={words.stepsLabel}>
        {feed.lines.map((line) => (
          <Step
            key={line.step.id}
            step={line.step}
            entry={line.entry}
            username={username}
            actingIn={actingIn}
            words={words}
            onDecide={onDecide}
          />
        ))}
      </ul>
    </div>
  );
}
