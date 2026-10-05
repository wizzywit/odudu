import { useState, type SubmitEvent } from 'react';
import {
  enteredTenant,
  signInLabel,
  signInToLabel,
  type Principal,
} from '#/features/session/service.ts';
import { SessionStatus } from '#/features/session/view/SessionStatus';
import { Button } from '#/shared/view/Button';
import { TextField } from '#/shared/view/Field';
import styles from '#/features/session/view/SignIn/SignIn.module.css';

// There is no username-first sign-in: usernames are unique per tenant, and
// asking across tenants would say which tenants a name belongs to.
export function SignIn({
  remembered,
  notice = null,
  enters = false,
  replacing = null,
  onSignIn,
  check,
}: {
  remembered: string | null;
  notice?: string | null;
  enters?: boolean;
  replacing?: Principal | null;
  onSignIn: (tenant: string) => void;
  check: (tenant: string) => string | undefined;
}) {
  const [asking, setAsking] = useState(remembered === null);
  const [tenant, setTenant] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = enteredTenant(tenant);
    const problem = check(name);
    setError(problem);
    if (problem === undefined) onSignIn(name);
  };
  return (
    <SessionStatus title="Sign in">
      {notice === null ? null : (
        <p role="alert" className={styles.notice}>
          {notice}
        </p>
      )}
      {remembered !== null && !asking ? (
        <div className={styles.remembered}>
          <p>
            You last signed in to <strong>{remembered}</strong> in this browser.
          </p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onPress={() => {
                onSignIn(remembered);
              }}
            >
              {signInToLabel(remembered)}
            </Button>
            <Button
              variant="quiet"
              onPress={() => {
                setAsking(true);
              }}
            >
              A different tenant
            </Button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className={styles.form}>
          {replacing === null ? null : (
            <p>
              You&apos;re signed in to <strong>{replacing.tenant}</strong> as{' '}
              <strong>{replacing.username}</strong>; signing in to another tenant ends that session
              once it succeeds.
            </p>
          )}
          <TextField
            label="Which tenant do you administer?"
            description="Its name, as it appears in the tenant's issuer URL."
            value={tenant}
            onChange={setTenant}
            error={error}
            mono
            autoFocus
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary">
              {signInLabel(enters, enteredTenant(tenant))}
            </Button>
          </div>
        </form>
      )}
    </SessionStatus>
  );
}
