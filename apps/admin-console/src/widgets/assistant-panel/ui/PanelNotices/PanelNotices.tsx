import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { Note } from '#/shared/ui/Note';
import type { Meter, PanelState } from '#/widgets/assistant-panel/types/chat';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import styles from '#/widgets/assistant-panel/ui/PanelNotices/PanelNotices.module.css';

function Notice({
  state,
  note,
  onJump,
  words,
}: {
  state: PanelState;
  note: string | null;
  onJump: (() => void) | null;
  words: PanelWords;
}) {
  switch (state.kind) {
    case 'failed':
      return (
        <section className={styles.failed} role="alert" aria-labelledby="assistant-failed-title">
          <h3 id="assistant-failed-title" className={styles.failedTitle}>
            {words.failedTitle}
          </h3>
          <p className={styles.failedCause}>{state.failure.cause}</p>
          {state.failure.trace === null ? null : (
            <p className={styles.trace}>
              <span>{words.traceLabel}</span>
              <CopyValue label={words.traceLabel} value={state.failure.trace} />
            </p>
          )}
        </section>
      );
    case 'budget':
      return (
        <Note tone="warning">
          <strong className={styles.lead}>{words.budgetStopTitle}</strong>
          {note}
        </Note>
      );
    case 'step-limit':
      return <Note tone="warning">{words.stepLimitNote}</Note>;
    case 'stopped':
      return <Note>{words.stoppedNote}</Note>;
    case 'waiting':
      return (
        <div className={styles.waiting}>
          <Note>{words.waitingNote}</Note>
          {onJump === null ? null : (
            <Button size="small" variant="secondary" onPress={onJump}>
              {words.cardJump}
            </Button>
          )}
        </div>
      );
    case 'closed':
      return <Note>{words.closedNote}</Note>;
    default:
      return null;
  }
}

// What sits between the log and the composer: the one short line a screen
// reader is told, kept in the page while empty so it is already listening, and
// the notice for how the turn ended. Tokens of an answer are never put here.
export function PanelNotices({
  state,
  statusText,
  running,
  note,
  meter,
  unavailable = false,
  onJump = null,
  words,
}: {
  state: PanelState;
  statusText: string;
  running: boolean;
  note: string | null;
  meter: Meter | null;
  // A tool answered that the assistant had been switched off.
  unavailable?: boolean;
  // Moves to the card of the change that waits, where there is one.
  onJump?: (() => void) | null;
  words: PanelWords;
}) {
  return (
    <div className={styles.notices}>
      <p
        role="status"
        aria-live="polite"
        aria-label={words.statusLabel}
        className={styles.status}
        data-running={running}
      >
        {statusText === '' ? null : <span className={styles.dot} aria-hidden="true" />}
        {statusText}
      </p>
      {meter?.level === 'warning' ? (
        <Note tone="warning">
          {meter.text}. {words.warningNote}
        </Note>
      ) : null}
      {unavailable ? <Note tone="warning">{words.unavailableNote}</Note> : null}
      <Notice state={state} note={note} onJump={onJump} words={words} />
    </div>
  );
}
