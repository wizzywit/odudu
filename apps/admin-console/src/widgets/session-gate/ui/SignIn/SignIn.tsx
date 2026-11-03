import { SessionStatus, type Principal } from '#/entities/session';
import { useSignInForm } from '#/widgets/session-gate/use-cases/useSignInForm';
import { Button } from '#/shared/ui/Button';
import { TextField } from '#/shared/ui/Field';
import styles from '#/widgets/session-gate/ui/SignIn/SignIn.module.css';

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
  const form = useSignInForm({ remembered, enters, onSignIn, check });
  return (
    <SessionStatus title="Sign in">
      {notice === null ? null : (
        <p role="alert" className={styles.notice}>
          {notice}
        </p>
      )}
      {remembered !== null && !form.asking ? (
        <div className={styles.remembered}>
          <p>
            You last signed in to <strong>{remembered}</strong> in this browser.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onPress={form.signInRemembered}>
              {form.rememberedLabel}
            </Button>
            <Button variant="quiet" onPress={form.ask}>
              A different tenant
            </Button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={form.submit} className={styles.form}>
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
            value={form.tenant}
            onChange={form.setTenant}
            error={form.error}
            mono
            autoFocus
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary">
              {form.submitLabel}
            </Button>
          </div>
        </form>
      )}
    </SessionStatus>
  );
}
