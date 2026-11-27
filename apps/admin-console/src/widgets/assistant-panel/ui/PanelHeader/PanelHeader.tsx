import type { RefObject } from 'react';
import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Button } from '#/shared/ui/Button';
import { Problem } from '#/shared/ui/Message';
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
  canStartNew,
  onStartNew,
  onShowConversations,
  conversationsRef,
  mode,
  modes,
  onModeChange,
  modeDisabled,
  modeProblem,
  acting = null,
  meter,
  models,
  words,
}: {
  title: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  closeLabel: string;
  onClose: () => void;
  canStartNew: boolean;
  onStartNew: () => void;
  // Shows the list of the person's conversations; `conversationsRef` is where
  // the focus comes back to when it is put away.
  onShowConversations: () => void;
  conversationsRef: RefObject<HTMLButtonElement | null>;
  mode: AssistantMode;
  modes: readonly AssistantMode[];
  // The value of the switch's choice, which the use case reads as a mode.
  onModeChange: (value: string) => void;
  // The mode cannot be switched now: an answer is running, or the conversation takes no message.
  modeDisabled: boolean;
  // Why the last switch did not go through, or null.
  modeProblem: string | null;
  // What names the tenant the conversation acts in, when it is not the person's
  // own: shown for as long as the panel is open, and Act is never offered there.
  acting?: string | null;
  // Null until the server has said something about the allowance.
  meter: Meter | null;
  // Named only where there is a choice of more than one.
  models: readonly { slot: string; model: string }[] | null;
  words: PanelWords;
}) {
  const actingTag =
    acting === null ? null : (
      <p className={styles.acting} title={acting}>
        {acting}
      </p>
    );
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
      <div className={styles.tools}>
        <Button
          ref={conversationsRef}
          size="small"
          variant="secondary"
          onPress={onShowConversations}
        >
          {words.conversationsButton}
        </Button>
        <Button size="small" variant="quiet" isDisabled={!canStartNew} onPress={onStartNew}>
          {words.newConversation}
        </Button>
      </div>
      {modes.length > 1 ? (
        <RadioGroup
          value={mode}
          orientation="horizontal"
          isDisabled={modeDisabled}
          onChange={onModeChange}
          className={styles.modes ?? ''}
        >
          <div className={styles.modeRow}>
            <Label className={styles.modeLabel ?? ''}>{words.modeLabel}</Label>
            {actingTag}
          </div>
          <div className={styles.segments}>
            {modes.map((choice) => (
              <RadioField
                key={choice}
                value={choice}
                isDisabled={choice === 'act' && acting !== null}
                className={styles.field ?? ''}
              >
                <RadioButton className={styles.segment ?? ''}>
                  {modeWords(words)[choice].label}
                </RadioButton>
              </RadioField>
            ))}
          </div>
          <p className={styles.modeHint}>{modeWords(words)[mode].hint}</p>
          {acting === null ? null : <p className={styles.modeHint}>{words.actOtherTenantNote}</p>}
          <Problem>{modeProblem}</Problem>
        </RadioGroup>
      ) : (
        actingTag
      )}
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
