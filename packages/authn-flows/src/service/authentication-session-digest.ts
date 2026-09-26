import { createHash } from 'node:crypto';

// An `auth_session_id` finishes a login that has already authenticated, so
// an audit row names it by this digest: one login's rows still share a
// `resource_id`, and nobody who can read them can continue that login.
export function authenticationSessionDigest(authSessionId: string): string {
  return createHash('sha256').update(authSessionId).digest('hex');
}
