import { type TenantScopedDatabase } from '@odudu/db';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { passkeyAuthenticationOptions, type PasskeyAuthenticationOffer } from '#/service/webauthn';

export interface BeginPasskeyAuthentication {
  publicBaseUrl: string;
  authSessionId: string;
}

// The other half of beginPasskeyEnrolment, and the same rule: the challenge
// is stored against the attempt, never rendered into a field the submission
// gives back. Nothing about the subject is read, because there is no
// subject — a usernameless assertion is the browser choosing among the
// discoverable credentials it holds, and who that turns out to be is
// settled when the assertion arrives.
export async function beginPasskeyAuthentication(
  tx: TenantScopedDatabase,
  input: BeginPasskeyAuthentication,
): Promise<PasskeyAuthenticationOffer> {
  const offer = await passkeyAuthenticationOptions(input.publicBaseUrl);
  await authenticationSessionRepository(tx).setWebauthnChallenge(
    input.authSessionId,
    offer.challenge,
  );
  return offer;
}
