import { safeReturnTo } from '#/services/return-to';
import type { Session as StoredSession } from '@odudu-io/bff';

const ID_SHAPE = /^[A-Za-z0-9_-]{16,128}$/u;

function isUnder(pathname: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Whether a path is one of the protected ones, matched on whole segments.
export function matchesPaths(pathname: string, paths: string[]): boolean {
  return paths.some((prefix) => isUnder(pathname, prefix));
}

export interface AccessInput {
  pathname: string;
  paths: string[];
  mountPath: string;
  // Asked only for a protected path.
  signedIn: () => Promise<boolean>;
}

// A path the BFF mounts is never protected: it is how a person signs in.
export async function decideAccess(input: AccessInput): Promise<'pass' | 'sign-in'> {
  const protectedPath =
    matchesPaths(input.pathname, input.paths) &&
    (input.mountPath === '' || !isUnder(input.pathname, input.mountPath));
  if (!protectedPath) return 'pass';
  return (await input.signedIn()) ? 'pass' : 'sign-in';
}

// Whether a session cookie's value stands for a signed-in browser. Without a
// store the value is only checked for the shape of an id, so this is a gate
// for the page, not proof of a session.
export async function isSignedIn(
  id: string | undefined,
  lookup: ((id: string) => Promise<StoredSession | undefined>) | undefined,
): Promise<boolean> {
  if (id === undefined || !ID_SHAPE.test(id)) return false;
  if (lookup === undefined) return true;
  return (await lookup(id))?.kind === 'session';
}

// The sign-in route with the page the person asked for as `returnTo`, or the
// root when that page is not one it may send them back to.
export function loginRedirectPath(loginPath: string, pathname: string, search: string): string {
  const target = safeReturnTo(`${pathname}${search}`) ?? '/';
  return `${loginPath}?returnTo=${encodeURIComponent(target)}`;
}
