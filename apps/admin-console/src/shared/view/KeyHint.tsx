import { createContext, Fragment, use } from 'react';
import { VisuallyHidden } from 'react-aria-components';
import {
  keyLabel,
  PLATFORM,
  type Key,
  type KeyLabel,
  type Platform,
} from '#/shared/service/platform.ts';
import styles from '#/shared/view/KeyHint.module.css';

// Set once for the page; a test names the platform it draws for.
export const PlatformContext = createContext<Platform>(PLATFORM);

// A glyph is seen and never read out; the key's name is read, and shown
// too where the platform shows it.
function Spoken({ label }: { label: KeyLabel }) {
  if (label.shown === label.spoken) return label.shown;
  if (label.shown.endsWith(label.spoken)) {
    return (
      <>
        <span aria-hidden="true">{label.shown.slice(0, -label.spoken.length)}</span>
        {label.spoken}
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true">{label.shown}</span>
      <VisuallyHidden>{label.spoken}</VisuallyHidden>
    </>
  );
}

// A shortcut told as information beside the control it triggers. Where the
// control carries aria-keyshortcuts itself, the hint is only seen.
export function KeyHint({
  id,
  lead,
  keys,
  announced = false,
}: {
  id?: string;
  lead: string;
  readonly keys: readonly Key[];
  announced?: boolean;
}) {
  const platform = use(PlatformContext);
  return (
    <span
      {...(id === undefined ? {} : { id })}
      className={styles.hint}
      {...(announced ? { 'aria-hidden': true } : {})}
    >
      {`${lead} `}
      {keys.map((key, index) => {
        const label = keyLabel(key, platform);
        return (
          <Fragment key={key}>
            {index > 0 ? '+' : null}
            <kbd className={styles.key}>
              <Spoken label={label} />
            </kbd>
          </Fragment>
        );
      })}
    </span>
  );
}
