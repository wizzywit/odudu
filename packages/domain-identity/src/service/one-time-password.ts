import { randomBytes } from 'node:crypto';

// 24 random bytes, base64url: shown once and never stored in the clear, so
// the length is chosen for pasting rather than for memorability. Used by
// `odudu seed admin` and by the admin API's password issue, both of which
// owe `update-password` beside it.
export function generateOneTimePassword(): string {
  return randomBytes(24).toString('base64url');
}
