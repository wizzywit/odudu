import type { Pending } from '@odudu-io/oidc';

function isPending(value: unknown): value is Pending {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'issuer' in value &&
    typeof value.issuer === 'string' &&
    'clientId' in value &&
    typeof value.clientId === 'string' &&
    'state' in value &&
    typeof value.state === 'string' &&
    'nonce' in value &&
    typeof value.nonce === 'string' &&
    'codeVerifier' in value &&
    typeof value.codeVerifier === 'string' &&
    'redirectUri' in value &&
    typeof value.redirectUri === 'string' &&
    'resources' in value &&
    Array.isArray(value.resources) &&
    'idTokenAlg' in value
  );
}

// The record the sign-in left, or undefined when there is none or it is not
// the record this package writes.
export function parsePending(stored: string | undefined): Pending | undefined {
  if (stored === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(stored);
    return isPending(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
