const MAX_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = 'http://return-to.invalid';

function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f || code === 0x5c) return true;
  }
  return false;
}

function pathOf(value: string): string {
  const end = value.search(/[?#]/u);
  return end === -1 ? value : value.slice(0, end);
}

function isUnder(path: string, prefix: string): boolean {
  return prefix !== '' && (path === prefix || path.startsWith(`${prefix}/`));
}

// A place on this origin to send the person after they sign in, or undefined.
// Only a path that starts with one slash qualifies, so a scheme, a host, a
// protocol-relative `//host` and a backslash a browser reads as a slash all
// fail; so does a path that hides a slash or backslash behind an escape, and
// a path under the BFF's own routes, which would start the sign-in again.
export function safeReturnTo(value: string | null | undefined, mount = ''): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value.length > MAX_LENGTH || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  if (hasUnsafeCharacter(value)) return undefined;
  const path = pathOf(value);
  if (/%(?:2f|5c)/iu.test(path) || isUnder(path, mount)) return undefined;
  return new URL(value, PLACEHOLDER_ORIGIN).origin === PLACEHOLDER_ORIGIN ? value : undefined;
}
