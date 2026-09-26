import { SessionEntry } from '#/service/session-entry';

export const PERSISTENT_SUFFIX = '-persistent';

const SEPARATOR = '.';

// `__Host-` requires Secure, and a browser rejects the whole cookie without
// it, so the compose stack's plain HTTP would silently break every local
// login. The name therefore follows TLS, and the fallback is announced at
// boot rather than shipping quietly — ADR 0020, which also lists the
// attributes the login handler must set alongside the name.
export function sessionCookieName(tenant: string, tls: boolean): string {
  return tls ? `__Host-${tenant}-session` : `${tenant}-session`;
}

export function warnIfCookieFallbackActive(
  tls: boolean,
  log: (message: string) => void = console.warn,
): void {
  if (!tls) {
    log(
      'authn-flows: serving session cookies without the __Host- prefix because TLS is off. ' +
        'This is expected for local development only — never in production.',
    );
  }
}

// The entries a browser presents, before any of them has been verified
// against a row.
export interface SessionEntries {
  readonly ephemeral: readonly SessionEntry[];
  readonly persistent: readonly SessionEntry[];
}

// The server keeps no secret after a session is created, so every entry
// here is either the one just issued or one the browser presented.
export interface SessionCookieInput {
  readonly tenant: string;
  readonly tls: boolean;
  readonly ephemeral: readonly SessionEntry[];
  readonly persistent: readonly SessionEntry[];
  readonly persistentMaxAgeSeconds: number;
}

function persistentName(tenant: string, tls: boolean): string {
  return `${sessionCookieName(tenant, tls)}${PERSISTENT_SUFFIX}`;
}

// ADR 0020 decides the name and nothing else; these are the attributes it
// names as the caller's to set, in one place so two routes cannot disagree.
function attributes(tls: boolean): string[] {
  return ['HttpOnly', 'SameSite=Lax', 'Path=/', ...(tls ? ['Secure'] : [])];
}

function cookie(name: string, value: string, tls: boolean, maxAge: number | null): string {
  const parts = [`${name}=${value}`, ...attributes(tls)];
  if (maxAge !== null) parts.push(`Max-Age=${String(maxAge)}`);
  return parts.join('; ');
}

// An empty list is written as an expiry rather than omitted: omitting it
// leaves whatever the browser already holds, which is how a logged-out
// session survives a logout.
function listCookie(
  name: string,
  entries: readonly SessionEntry[],
  tls: boolean,
  maxAge: number | null,
): string {
  if (entries.length === 0) return cookie(name, '', tls, 0);
  return cookie(name, entries.map((entry) => entry.cookieValue()).join(SEPARATOR), tls, maxAge);
}

export function sessionCookies(input: SessionCookieInput): readonly string[] {
  return [
    listCookie(sessionCookieName(input.tenant, input.tls), input.ephemeral, input.tls, null),
    listCookie(
      persistentName(input.tenant, input.tls),
      input.persistent,
      input.tls,
      input.persistentMaxAgeSeconds,
    ),
  ];
}

export function clearedSessionCookies(tenant: string, tls: boolean): readonly string[] {
  return [
    cookie(sessionCookieName(tenant, tls), '', tls, 0),
    cookie(persistentName(tenant, tls), '', tls, 0),
  ];
}

function entriesOf(header: string, name: string): readonly SessionEntry[] {
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair
      .slice(index + 1)
      .trim()
      .split(SEPARATOR)
      .map((value) => SessionEntry.parse(value))
      .filter((entry) => entry !== null);
  }
  return [];
}

// A malformed entry is dropped rather than refused. A browser keeps cookies
// across a database reset and a person can edit one; a request that fails
// because of a value the server itself wrote months ago is a login nobody
// can complete and nothing explains.
export function readSessionEntries(
  header: string | undefined,
  tenant: string,
  tls: boolean,
): SessionEntries {
  if (header === undefined) return { ephemeral: [], persistent: [] };
  return {
    ephemeral: entriesOf(header, sessionCookieName(tenant, tls)),
    persistent: entriesOf(header, persistentName(tenant, tls)),
  };
}
