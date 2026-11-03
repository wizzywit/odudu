import { useSigningInText } from '#/entities/session/use-cases/useSigningInText';
import { SessionStatus } from '#/entities/session/ui/SessionStatus';

export function SigningIn({ tenant, ended }: { tenant: string | null; ended: boolean }) {
  const words = useSigningInText(tenant, ended);
  return (
    <SessionStatus title={words.title}>
      <p role="status">{words.text}</p>
      {ended ? (
        <p>Unsaved changes in this tab come back after you sign in, marked for review.</p>
      ) : null}
    </SessionStatus>
  );
}
