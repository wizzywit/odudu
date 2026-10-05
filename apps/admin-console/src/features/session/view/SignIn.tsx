import { useState, type SubmitEvent } from 'react';
import type { Principal } from '#/features/session/service.ts';
import { Button } from '#/shared/view/Button';
import { TextField } from '#/shared/view/Field';
import styles from '#/features/session/view/SignIn.module.css';

function submitLabel(enters: boolean, tenant: string): string {
  if (!enters) return 'Continue to sign-in';
  return tenant === '' ? 'Enter tenant' : `Enter ${tenant}`;
}

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
    const name = tenant.trim();
    const problem = check(name);
    setError(problem);
    if (problem === undefined) onSignIn(name);
  };
  return (
    <main id="main" tabIndex={-1} className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>Odudu console</p>
        <h1 className={styles.title}>Sign in</h1>
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
                {`Sign in to ${remembered}`}
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
                <strong>{replacing.username}</strong>; signing in to another tenant ends that
                session once it succeeds.
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
                {submitLabel(enters, tenant.trim())}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
