import { ACCESS_TOKEN_CEILING_SECONDS } from '@odudu/contracts/admin';
import { counted } from '#/shared/lib/services/format';

const HOUR = 3_600;
const MINUTE = 60;

// How long the previous address keeps serving what was issued: the ceiling
// the token endpoint puts on an access token's lifetime.
export function windowWords(seconds: number): string {
  if (seconds % HOUR === 0) return counted(seconds / HOUR, 'hour', 'hours');
  if (seconds % MINUTE === 0) return counted(seconds / MINUTE, 'minute', 'minutes');
  return counted(seconds, 'second', 'seconds');
}

export function transitionNote(seconds: number = ACCESS_TOKEN_CEILING_SECONDS): string {
  return `For ${windowWords(seconds)} after a switch the previous address keeps serving the token, userinfo, introspection, revocation, key, logout and discovery endpoints, so what was already issued keeps working. It refuses sign-in, registration and password-reset pages, and points to the new address. After that it serves nothing for this tenant.`;
}
