import type { SigningKeyStatus } from '#/entities/signing-key/types/signingKey';

// What a key published in the JWKS is called when the key list does not say:
// `unlisted` is published but absent from the list, `unknown` is a list that
// could not be read.
export type PublishedLane = SigningKeyStatus | 'unlisted' | 'unknown';

export function publishedLane(
  listed: SigningKeyStatus | undefined,
  listRead: boolean,
): PublishedLane {
  if (!listRead) return 'unknown';
  return listed ?? 'unlisted';
}
