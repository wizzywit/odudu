import { Link } from 'react-aria-components';
import type { Principal } from '#/features/session/service.ts';
import { SessionStatus } from '#/features/session/view/SessionStatus.tsx';
import { Button } from '#/shared/view/Button';
import styles from '#/features/session/view/SignIn.module.css';

// A page, not a dialog: nothing destructive has been asked for yet, and
// going back sends nothing.
export function SignedInElsewhere({
  principal,
  tenant,
  onSignIn,
}: {
  principal: Principal;
  tenant: string;
  onSignIn: () => void;
}) {
  return (
    <SessionStatus title={`Signed in to ${principal.tenant}`}>
      <p>
        You&apos;re signed in to <strong>{principal.tenant}</strong> as{' '}
        <strong>{principal.username}</strong>.
      </p>
      <div className={styles.actions}>
        <Link
          href={`/console/${encodeURIComponent(principal.tenant)}`}
          className={styles.back ?? ''}
        >
          {`Back to ${principal.tenant}`}
        </Link>
        <Button variant="primary" onPress={onSignIn}>
          {`Sign in to ${tenant}`}
        </Button>
      </div>
    </SessionStatus>
  );
}
