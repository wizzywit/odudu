import { Fragment, type ReactElement } from 'react';
import type { InstallPanel } from '@site/src/features/landing/services/installView';
import type { TypedSegment } from '@site/src/features/landing/services/installTyping';
import { useInstall } from '@site/src/features/landing/use-cases/useInstall';
import styles from '@site/src/features/landing/ui/Install/Install.module.css';

const LINE_LOOKS = { command: undefined, output: styles.output };

// A command broken after each slash, so a long address wraps at a slash.
function Wrapped({ command }: { command: InstallPanel['command'] }): ReactElement {
  return (
    <>
      {command.map((piece, index) => (
        <Fragment key={`${piece.text}-${String(index)}`}>
          {piece.breakBefore ? <wbr /> : null}
          {piece.text}
        </Fragment>
      ))}
    </>
  );
}

// The same breaks as the real text, with only the typed characters shown.
function WrappedTyped({ typed }: { typed: TypedSegment[] }): ReactElement {
  return (
    <>
      {typed.map(({ shown, hidden, hasHidden, breakBefore }, index) => (
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
  const { view, choose, copy } = useInstall();
  return (
    <fieldset className={styles.install}>
      <legend className="visually-hidden">Your shell</legend>
      {view.shells.map((entry) => (
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
          {view.shells.map((entry) => (
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
        <button type="button" className={styles.copy} hidden={view.copyBar.hidden} onClick={copy}>
          {view.copyBar.label}
          <span className="visually-hidden"> the command</span>
        </button>
      </div>
      {view.panels.map((panel) => (
        <div key={panel.shell} className={styles.panel} data-panel={panel.shell}>
          <div className={styles.typeWrap}>
            <code data-shell={panel.shell} data-typing={panel.typing}>
              <Wrapped command={panel.command} />
            </code>
            {panel.overlay ? (
              <span className={styles.typed} aria-hidden="true">
                <WrappedTyped typed={panel.overlay} />
              </span>
            ) : null}
          </div>
          <div className={styles.followUp}>
            {panel.lines.map((line) => (
              <code
                key={line.text}
                className={LINE_LOOKS[line.kind]}
                data-visible={String(line.visible)}
              >
                {line.text}
              </code>
            ))}
          </div>
        </div>
      ))}
      <p className={styles.installNote} role="status" data-install-note="">
        {view.copyBar.note}
      </p>
    </fieldset>
  );
}
