import type { SigningInWords } from '#/entities/session/services/sessionStatusText';
import { SessionStatus } from '#/entities/session/ui/SessionStatus';

export function SigningIn({ words, ended }: { words: SigningInWords; ended: boolean }) {
  return (
    <SessionStatus title={words.title}>
      <p role="status">{words.text}</p>
      {ended ? (
        <p>Unsaved changes in this tab come back after you sign in, marked for review.</p>
      ) : null}
    </SessionStatus>
  );
}
