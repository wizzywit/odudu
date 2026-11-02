import { Fragment, type ReactElement } from 'react';
import {
  TYPED_COMMAND,
  copyLabel,
  followUpLines,
  lineVisible,
  noteFor,
  overlayShown,
  panelTyping,
  pieces,
  shellChoices,
  typedSegments,
} from '@site/src/features/landing/services/terminal';
import { useInstall } from '@site/src/features/landing/use-cases/useInstall';
import styles from '@site/src/features/landing/ui/Install/Install.module.css';

const LINE_LOOKS = { command: undefined, output: styles.output };

// A command broken after each slash, so a long address wraps at a slash.
function Wrapped({ text }: { text: string }): ReactElement {
  return (
    <>
      {pieces(text).map((piece, index) => (
        <Fragment key={`${piece.text}-${String(index)}`}>
          {piece.breakBefore ? <wbr /> : null}
          {piece.text}
        </Fragment>
      ))}
    </>
  );
}

// The same breaks as the real text, with only the first `count` characters shown.
function WrappedTyped({ text, count }: { text: string; count: number }): ReactElement {
  return (
    <>
      {typedSegments(text, count).map(({ shown, hidden, hasHidden, breakBefore }, index) => (
        <Fragment key={`${shown}${hidden}-${String(index)}`}>
          {breakBefore ? <wbr /> : null}
          {shown}
          {hasHidden ? <span className={styles.rest}>{hidden}</span> : null}
        </Fragment>
      ))}
    </>
  );
}

// The radios and their panels work with no script, through the sibling
// selectors in Install.module.css; the copy button appears once React has run.
export function Install(): ReactElement {
  const { shell, status, typing, typed, lines, interactive, choose, copy } = useInstall();
  return (
    <fieldset className={styles.install}>
      <legend className="visually-hidden">Your shell</legend>
      {shellChoices(shell).map((entry) => (
        <input
          key={entry.shell}
          className={[styles.shellRadio, 'visually-hidden'].join(' ')}
          type="radio"
          name="shell"
          id={`shell-${entry.shell}`}
          data-shell={entry.shell}
          checked={entry.checked}
          onChange={() => {
            choose(entry.shell);
          }}
        />
      ))}
      <div className={styles.installBar}>
        <div className={styles.shells}>
          {shellChoices(shell).map((entry) => (
            <label
              key={entry.shell}
              className={styles.shellLabel}
              htmlFor={`shell-${entry.shell}`}
              data-shell={entry.shell}
            >
              {entry.label}
            </label>
          ))}
        </div>
        <button type="button" className={styles.copy} hidden={!interactive} onClick={copy}>
          {copyLabel(status)}
          <span className="visually-hidden"> the command</span>
        </button>
      </div>
      {shellChoices(shell).map((entry) => (
        <div key={entry.shell} className={styles.panel} data-panel={entry.shell}>
          <div className={styles.typeWrap}>
            <code data-shell={entry.shell} data-typing={panelTyping(entry.shell, typing)}>
              <Wrapped text={entry.command} />
            </code>
            {overlayShown(entry.shell, shell, typing) ? (
              <span className={styles.typed} aria-hidden="true">
                <WrappedTyped text={TYPED_COMMAND} count={typed} />
              </span>
            ) : null}
          </div>
          <div className={styles.followUp}>
            {followUpLines().map((line, index) => (
              <code
                key={line.text}
                className={LINE_LOOKS[line.kind]}
                data-visible={String(lineVisible(entry.shell, typing, lines, index))}
              >
                {line.text}
              </code>
            ))}
          </div>
        </div>
      ))}
      <p className={styles.installNote} role="status" data-install-note="">
        {noteFor(status)}
      </p>
    </fieldset>
  );
}
