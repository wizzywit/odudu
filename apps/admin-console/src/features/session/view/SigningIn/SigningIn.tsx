import { signingInText, signingInTitle } from '#/features/session/service.ts';
import { SessionStatus } from '#/features/session/view/SessionStatus';

export function SigningIn({ tenant, ended }: { tenant: string | null; ended: boolean }) {
  return (
    <SessionStatus title={signingInTitle(ended)}>
      <p role="status">{signingInText(tenant)}</p>
      {ended ? (
        <p>Unsaved changes in this tab come back after you sign in, marked for review.</p>
      ) : null}
    </SessionStatus>
  );
}
