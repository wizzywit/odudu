import { Link } from 'react-aria-components';
import { type Principal } from '#/entities/session/types/principal';
import type { SignedInElsewhereWords } from '#/entities/session/services/sessionStatusText';
import { SessionStatus } from '#/entities/session/ui/SessionStatus';
import { Button } from '#/shared/ui/Button';
import styles from '#/entities/session/ui/SignedInElsewhere/SignedInElsewhere.module.css';

// A page, not a dialog: nothing destructive has been asked for yet, and
// going back sends nothing.
export function SignedInElsewhere({
  principal,
  words,
  onSignIn,
}: {
  principal: Principal;
  words: SignedInElsewhereWords;
  onSignIn: () => void;
}) {
  return (
    <SessionStatus title={words.title}>
      <p>
        You&apos;re signed in to <strong>{principal.tenant}</strong> as{' '}
        <strong>{principal.username}</strong>.
      </p>
      <div className={styles.actions}>
        <Link href={words.backHref} className={styles.back ?? ''}>
          {words.backLabel}
        </Link>
        <Button variant="primary" onPress={onSignIn}>
          {words.signInLabel}
        </Button>
      </div>
    </SessionStatus>
  );
}
