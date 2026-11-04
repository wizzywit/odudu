import { addressPath, MAX_SIGN_IN_PATH_LENGTH, type TenantAddress } from '@odudu/kernel';

// Where an account page sends a person back to sign in: the authorize path
// the sign-in page rebuilt from the parked request, carried through the
// account pages as a `return_to` value. It is accepted only in exactly that
// shape (this tenant's authorize endpoint, a query, printable ASCII, no
// fragment), so a link built from it is a path on this server and never a
// foreign address; /authorize validates the request again from scratch. The
// parked request's id is never put in a URL, which is why the request travels
// as its own parameters instead.

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/u;

export function signInPath(
  address: TenantAddress,
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== 'string' || value.length > MAX_SIGN_IN_PATH_LENGTH) return null;
  const prefix = addressPath(address, '/protocol/openid-connect/auth?');
  if (!value.startsWith(prefix) || value.length === prefix.length) return null;
  if (!PRINTABLE_ASCII.test(value) || value.includes('\\') || value.includes('#')) return null;
  return value;
}
