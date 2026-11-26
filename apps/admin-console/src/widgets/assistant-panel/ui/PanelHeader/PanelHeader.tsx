import type { RefObject } from 'react';
import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Button } from '#/shared/ui/Button';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import type { AssistantMode, Meter } from '#/widgets/assistant-panel/types/chat';
import styles from '#/widgets/assistant-panel/ui/PanelHeader/PanelHeader.module.css';

function modeWords(words: PanelWords): Record<AssistantMode, { label: string; hint: string }> {
  return {
    ask: { label: words.modeAsk, hint: words.modeAskHint },
    act: { label: words.modeAct, hint: words.modeActHint },
  };
}

// The panel's title, the mode switch, what has been used of the allowance and,
// where more than one model is configured, which they are. The title takes the
// focus as the panel opens, so a screen reader starts at the top.
export function PanelHeader({
  title,
  headingRef,
  closeLabel,
  onClose,
  mode,
  modes,
  meter,
  models,
  words,
}: {
  title: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  closeLabel: string;
  onClose: () => void;
  mode: AssistantMode;
  modes: readonly AssistantMode[];
  // Null until the server has said something about the allowance.
  meter: Meter | null;
  // Named only where there is a choice of more than one.
  models: readonly { slot: string; model: string }[] | null;
  words: PanelWords;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        <Button size="small" variant="quiet" onPress={onClose}>
          {closeLabel}
        </Button>
      </div>
      {modes.length > 1 ? (
        <RadioGroup
          value={mode}
          orientation="horizontal"
          isDisabled={mode === 'act'}
          className={styles.modes ?? ''}
        >
          <Label className={styles.modeLabel ?? ''}>{words.modeLabel}</Label>
          <div className={styles.segments}>
            {modes.map((choice) => (
              <RadioField
                key={choice}
                value={choice}
                isDisabled={choice === 'act'}
                className={styles.field ?? ''}
              >
                <RadioButton className={styles.segment ?? ''}>
                  {modeWords(words)[choice].label}
                </RadioButton>
              </RadioField>
            ))}
          </div>
          <p className={styles.modeHint}>{modeWords(words)[mode].hint}</p>
          <p className={styles.modeHint}>{words.actNote}</p>
        </RadioGroup>
      ) : null}
      {meter === null && models === null ? null : (
        <div className={styles.meterRow}>
          {meter === null ? null : (
            <p className={styles.meter} data-level={meter.level}>
              {meter.text}
            </p>
          )}
          {models === null ? null : (
            <details className={styles.models}>
              <summary className={styles.modelsSummary}>{words.modelsSummary}</summary>
              <ul className={styles.modelList}>
                {models.map((entry) => (
                  <li key={entry.slot}>
                    <span className={styles.slot}>{entry.slot}</span> {entry.model}
                  </li>
                ))}
              </ul>
              <p className={styles.modelsNote}>{words.modelsNote}</p>
            </details>
          )}
        </div>
      )}
    </header>
  );
}
