import { Link } from 'react-aria-components';
import {
  backToLabel,
  signedInToTitle,
  signInToLabel,
  tenantPage,
  type Principal,
} from '#/features/session/service';
import { SessionStatus } from '#/features/session/view/SessionStatus';
import { Button } from '#/shared/view/Button';
import styles from '#/features/session/view/SignedInElsewhere/SignedInElsewhere.module.css';

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
    <SessionStatus title={signedInToTitle(principal.tenant)}>
      <p>
        You&apos;re signed in to <strong>{principal.tenant}</strong> as{' '}
        <strong>{principal.username}</strong>.
      </p>
      <div className={styles.actions}>
        <Link href={tenantPage(principal.tenant)} className={styles.back ?? ''}>
          {backToLabel(principal.tenant)}
        </Link>
        <Button variant="primary" onPress={onSignIn}>
          {signInToLabel(tenant)}
        </Button>
      </div>
    </SessionStatus>
  );
}
