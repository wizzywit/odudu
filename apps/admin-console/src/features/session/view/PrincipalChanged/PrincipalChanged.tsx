import type { Principal } from '#/features/session/service.ts';
import { SessionStatus } from '#/features/session/view/SessionStatus';
import { Button } from '#/shared/view/Button';
import styles from '#/features/session/view/PrincipalChanged/PrincipalChanged.module.css';

// A page rather than a quiet switch: the tab was showing one administrator
// and the browser is now another's, and only the person at it can say which.
export function PrincipalChanged({
  was,
  now,
  onCarryOn,
  onSignInAgain,
}: {
  was: Principal;
  now: Principal;
  onCarryOn: () => void;
  onSignInAgain: () => void;
}) {
  return (
    <SessionStatus title="Signed in as somebody else">
      <p>
        This browser is now signed in as <strong>{now.username}</strong> in{' '}
        <strong>{now.tenant}</strong>.
      </p>
      <p>
        Unsaved changes made as {was.username} are kept in this tab for when {was.username} signs in
        again. Continuing as {now.username} discards them.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onPress={onSignInAgain}>
          {`Sign in as ${was.username} again`}
        </Button>
        <Button variant="quiet" onPress={onCarryOn}>
          {`Continue as ${now.username}`}
        </Button>
      </div>
    </SessionStatus>
  );
}
