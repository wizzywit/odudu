// Exact string comparison, deliberately. OAuth 2.1 requires it, and every
// normalization added here — trailing slashes, case folding, ignoring a
// query string — widens what an attacker can register into. The one
// exception is RFC 8252 §7.3, below.
export function isRegisteredRedirectUri(
  presented: string,
  registered: readonly string[],
  clientType: 'public' | 'confidential',
): boolean {
  if (registered.includes(presented)) return true;
  return clientType === 'public' && registered.some((uri) => matchesLoopbackPort(presented, uri));
}

const LOOPBACK_LITERALS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

// RFC 8252 §7.3: a native app listens on an ephemeral port, so a loopback IP
// literal registered without a port stands for that address at any port.
// Only the literals: `localhost` resolves through a resolver the app does not
// control (§8.3), and a registration that names a port is matched exactly.
export function matchesLoopbackPort(
  presented: string,
  registered: string,
  hosts: ReadonlySet<string> = LOOPBACK_LITERALS,
): boolean {
  // The presented string is what the browser is redirected to; refuse every
  // character a URL parser would drop or reinterpret before it is compared,
  // and everything outside ASCII (a fullwidth host folds to 127.0.0.1).
  if (/[^\u0021-\u007e]|\\/.test(presented)) return false;
  if (!URL.canParse(registered) || !URL.canParse(presented)) return false;
  const base = new URL(registered);
  if (base.protocol !== 'http:' || base.port !== '') return false;
  if (!hosts.has(base.hostname)) return false;
  const candidate = new URL(presented);
  return (
    candidate.protocol === 'http:' &&
    candidate.hostname === base.hostname &&
    candidate.username === '' &&
    candidate.password === '' &&
    candidate.hash === '' &&
    !presented.includes('#') &&
    candidate.port !== '0' &&
    candidate.pathname === base.pathname &&
    candidate.search === base.search
  );
}
