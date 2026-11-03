import type { ReactElement } from 'react';
import type { Step } from '@site/src/features/landing/services/signInBeats';
import type { StepperButton } from '@site/src/features/landing/services/flowView';
import styles from '@site/src/features/landing/ui/FlowControls/FlowControls.module.css';

interface Props {
  step: Step;
  buttons: StepperButton[];
  playing: boolean;
  running: boolean;
  holdMs: number;
  label: 'Pause' | 'Play';
  live: string;
  leaving: string;
  moved: boolean;
  handOver: 'none' | 'timed' | 'click';
  marker: Step;
  widest: string;
  politeness: 'off' | 'polite';
  onChoose: (step: Step) => void;
  onToggle: () => void;
  onReplay: () => void;
}

// Pause and Replay first, then the seven steps under one sliding marker, then
// what the current step says, handed over from what the last one said.
export function FlowControls({
  step,
  buttons,
  playing,
  running,
  holdMs,
  label,
  live,
  leaving,
  moved,
  handOver,
  marker,
  widest,
  politeness,
  onChoose,
  onToggle,
  onReplay,
}: Props): ReactElement {
  return (
    <div className={styles.controls}>
      <div className={styles.controlRow}>
        <div className={styles.transport}>
          <button
            type="button"
            className={styles.control}
            aria-pressed={playing}
            aria-label={`${label} autoplay`}
            onClick={onToggle}
          >
            {label}
          </button>
          <button type="button" className={styles.control} onClick={onReplay}>
            Replay
          </button>
        </div>
        <div
          className={styles.stepper}
          role="group"
          aria-label="Steps"
          data-step={String(step)}
          data-marker={String(marker)}
        >
          <span className={styles.pill} data-pill="" aria-hidden="true">
            {running ? (
              <span
                key={String(step)}
                className={styles.fill}
                data-fill=""
                style={{ animationDuration: `${String(holdMs)}ms` }}
              />
            ) : null}
          </span>
          {buttons.map((button) => (
            <button
              key={button.label}
              type="button"
              className={styles.stepButton}
              aria-label={button.label}
              aria-current={button.current}
              onClick={() => {
                onChoose(button.step);
              }}
            >
              <span className={styles.stepNumber} aria-hidden="true">
                {button.number}
              </span>
              <span className={styles.stepLabel} aria-hidden="true">
                {button.short}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.live} role="status" aria-live={politeness} data-live="">
        <p className={styles.liveSizer} aria-hidden="true" data-caption="sizer">
          {widest}
        </p>
        {moved ? (
          <p key={`out-${live}`} className={styles.liveOut} data-caption="out" aria-hidden="true">
            {leaving}
          </p>
        ) : null}
        <p key={`in-${live}`} className={styles.liveIn} data-caption="in" data-hand-over={handOver}>
          {live}
        </p>
      </div>
    </div>
  );
}
