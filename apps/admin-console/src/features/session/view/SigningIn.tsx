import { SessionStatus } from '#/features/session/view/SessionStatus.tsx';

export function SigningIn({ tenant, ended }: { tenant: string | null; ended: boolean }) {
  return (
    <SessionStatus title={ended ? 'Your session ended' : 'Signing in'}>
      <p role="status">
        {tenant === null ? 'Opening the console…' : `Taking you to ${tenant}'s sign-in…`}
      </p>
      {ended ? (
        <p>Unsaved changes in this tab come back after you sign in, marked for review.</p>
      ) : null}
    </SessionStatus>
  );
}
