import { useEffect, useState } from 'react';
import { VisuallyHidden } from 'react-aria-components';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/CopyValue.module.css';

type Outcome = 'idle' | 'copied' | 'failed';

const SHORT_LENGTH = 8;
const SETTLE_MS = 2_000;

export function CopyValue({
  label,
  value,
  short = false,
}: {
  label: string;
  value: string;
  short?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>('idle');

  useEffect(() => {
    if (outcome === 'idle') return undefined;
    const timer = setTimeout(() => {
      setOutcome('idle');
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [outcome]);

  const copy = (): void => {
    // Emptied first, so a live region repeats an outcome it already shows.
    setOutcome('idle');
    // Outside a secure context navigator.clipboard is absent, which throws here.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(
        () => {
          setOutcome('copied');
        },
        () => {
          setOutcome('failed');
        },
      );
  };

  const shortened = short && value.length > SHORT_LENGTH;
  return (
    <span className={styles.copy}>
      <code className={styles.value}>
        {shortened ? (
          <>
            <span aria-hidden="true">{`${value.slice(0, SHORT_LENGTH)}…`}</span>
            <VisuallyHidden elementType="span">{value}</VisuallyHidden>
          </>
        ) : (
          value
        )}
      </code>
      <Button size="small" variant="quiet" onPress={copy} aria-label={`Copy ${label}`}>
        Copy
      </Button>
      <span role="status" className={styles.outcome} data-outcome={outcome}>
        {outcome === 'copied' ? `Copied ${label}` : null}
        {outcome === 'failed' ? `Could not copy ${label}` : null}
      </span>
    </span>
  );
}
