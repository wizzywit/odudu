import { isSignedIn } from '#/services/auth-gate';
import type { SessionStore } from '@odudu-io/bff';
import type { NextRequest } from 'next/server.js';

// A check, made only when asked, of whether a request's session cookie stands
// for a signed-in browser.
export type SignedInCheck = (request: NextRequest) => () => Promise<boolean>;

export function createSignedInCheck(
  cookieName: string,
  store: SessionStore | undefined,
): SignedInCheck {
  const lookup = store === undefined ? undefined : (key: string) => store.get(key);
  return (request) => () => isSignedIn(request.cookies.get(cookieName)?.value, lookup);
}
