import { isUuid } from '@odudu/kernel';
import { sameSecret } from '#/service/secrets';

const IAT_SKEW_SECONDS = 60;

export interface ExpectedIdToken {
  readonly nonce: string;
  readonly clientId: string;
  readonly now: Date;
}

// The checks OIDC Core §3.1.3.7 leaves to the client once the signature,
// issuer, audience and expiry have passed: the nonce this login sent, an
// azp naming this client wherever one is given or several audiences need
// it, and an issue time not in the future. Answers the subject, or null.
export function subjectOfIdToken(
  claims: Readonly<Record<string, unknown>>,
  expected: ExpectedIdToken,
): string | null {
  const { nonce, sub, aud, azp, iat } = claims;
  if (typeof nonce !== 'string' || !sameSecret(nonce, expected.nonce)) return null;
  if (typeof sub !== 'string' || !isUuid(sub)) return null;
  if (azp !== undefined && azp !== expected.clientId) return null;
  if (Array.isArray(aud) && aud.length > 1 && azp === undefined) return null;
  if (typeof iat !== 'number') return null;
  if (iat > expected.now.getTime() / 1000 + IAT_SKEW_SECONDS) return null;
  return sub;
}
