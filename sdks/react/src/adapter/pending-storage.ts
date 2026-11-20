import type { Pending } from '@odudu-io/oidc';

// The only thing this package writes to storage: what the redirect to the
// issuer needs to come back (the PKCE verifier, state and nonce). It lives in
// sessionStorage, so it stays in the one tab, and is removed when read. No
// token is ever stored.
export const PENDING_KEY = 'odudu.pending';

export function savePending(pending: Pending): void {
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function hasPending(): boolean {
  return window.sessionStorage.getItem(PENDING_KEY) !== null;
}

// Removes the record as it reads it: a callback can be used once.
export function takePending(): unknown {
  const stored = window.sessionStorage.getItem(PENDING_KEY);
  window.sessionStorage.removeItem(PENDING_KEY);
  return stored === null ? undefined : (JSON.parse(stored) as unknown);
}
