import { SessionStatus, type Principal } from '#/entities/session';
import { Button } from '#/shared/ui/Button';
import styles from '#/widgets/session-gate/ui/PrincipalChanged/PrincipalChanged.module.css';

// A page rather than a quiet switch: the tab was showing one administrator
// and the browser is now another's, and only the person at it can say which.
export function PrincipalChanged({
  was,
  now,
  signInAgainLabel,
  continueAsLabel,
  onCarryOn,
  onSignInAgain,
}: {
  was: Principal;
  now: Principal;
  signInAgainLabel: string;
  continueAsLabel: string;
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
          {signInAgainLabel}
        </Button>
        <Button variant="quiet" onPress={onCarryOn}>
          {continueAsLabel}
        </Button>
      </div>
    </SessionStatus>
  );
}
