import type { Deps, Pending, TokenSet } from '@odudu-io/oidc';

export type Handler = (request: Request) => Promise<Response>;

// A signed-in browser. The cookie holds the id this record is stored under and
// nothing else; the tokens never leave the server.
export interface SignedInSession {
  kind: 'session';
  tokens: TokenSet;
  // Milliseconds since the epoch.
  createdAt: number;
}

// A sign-in that has started and not yet come back. It holds the PKCE
// verifier, so it is bound to the browser that started it by a cookie.
export interface LoginInProgress {
  kind: 'login';
  pending: Pending;
  createdAt: number;
}

export type Session = SignedInSession | LoginInProgress;

// Where sessions live. `ttlMs` is the longest the record may be kept; a store
// may drop it sooner. Records are plain JSON, so a shared store can serialise
// them as they are.
export interface SessionStore {
  get(id: string): Promise<Session | undefined>;
  set(id: string, session: Session, ttlMs: number): Promise<void>;
  delete(id: string): Promise<void>;
  // Optional; for a store shared by several instances (ADR 0054). Takes an
  // exclusive lock on `lock:<session id>`, a key of its own, for at most `ttlMs`
  // (120 s, longer than a refresh takes) and resolves with its release function,
  // or undefined when the lock is not obtained after a short wait. The function
  // must release only its holder's own lock (compare a random value stored with
  // it), because a lapsed lock may belong to the next holder.
  lock?(id: string, ttlMs: number): Promise<(() => Promise<void>) | undefined>;
}

// A server the proxy may call for a signed-in browser. The browser names it by
// `name` and may reach only the paths under `pathPrefixes`, so the allowlist is
// the origin plus those prefixes and nothing a request carries decides it.
export interface Upstream {
  // The first path segment after the proxy path: `<proxyPath>/<name>/...`.
  name: string;
  // An exact origin: scheme, host and port, no path. `https`, unless the host
  // is localhost, 127.0.0.1 or [::1] or `deps.allowInsecureRequests` is set.
  origin: string;
  // Paths the browser may reach, matched on whole segments. None proxies nothing.
  pathPrefixes: string[];
  // GET, POST, PUT, PATCH and DELETE when omitted.
  methods?: string[];
  // The audience whose access token is sent; the issuer's own when omitted. It
  // must be one of the sign-in's `resource` values.
  resource?: string;
}

export interface BffOptions {
  issuer: string;
  clientId: string;
  // The BFF is a confidential client (RFC 10017 section 6.1.3.1). Without a
  // secret it signs in as a public client, which is for development only.
  clientSecret?: string;
  // The address of the `callback` route as the browser reaches it.
  redirectUri: string;
  scope: string;
  // Audiences the sign-in asks access tokens for (RFC 8707), for upstreams that
  // name a `resource`.
  resource?: string[];
  store?: SessionStore;
  // Must start with `__Host-`; the login cookie is `<cookieName>-login`.
  cookieName?: string;
  // Where the issuer sends the person after they confirm the sign-out; it must
  // be registered for the client. Sent without an ID token hint: no token of
  // any kind reaches the browser, so the issuer asks the person to confirm.
  postLogoutRedirectUri?: string;
  // Origins whose browser pages may call the state-changing routes. Defaults
  // to the origin of `redirectUri`.
  allowedOrigins?: string[];
  // Where `callback` sends the browser afterwards; `/` when omitted.
  afterSignInPath?: string;
  // The longest a session is kept, whatever its use. 7 days when omitted.
  sessionTtlMs?: number;
  // Servers the `proxy` route may call. None, and the proxy answers 404.
  upstreams?: Upstream[];
  // Where the routes are mounted, as a path of this origin: `''` (the root) when
  // omitted. The framework adapters take it as their default `prefix`, and the
  // proxy defaults to `${mountPath}/proxy`.
  mountPath?: string;
  // Where the browser reaches the proxy, as a path of this origin; `/proxy`
  // when omitted. The framework adapters mount the route here.
  proxyPath?: string;
  // The most bytes of a request body, and of a response body, the proxy passes:
  // 10 MiB when omitted.
  maxBodyBytes?: number;
  // How long the proxy waits for an upstream to start answering; 30 seconds when
  // omitted.
  upstreamTimeoutMs?: number;
  // How long a response body may go without a chunk once the upstream has
  // started answering; the proxy then cuts the response off. 30 seconds when
  // omitted.
  upstreamIdleMs?: number;
  // Passed to the OIDC core: a fetch, a clock, `allowInsecureRequests`. The
  // proxy calls its upstreams with the same fetch.
  deps?: Deps;
}

export interface Bff {
  login: Handler;
  callback: Handler;
  logout: Handler;
  session: Handler;
  // Calls an allowlisted upstream with the session's access token. Mount it
  // for every method at `${proxyPath}/*`.
  proxy: Handler;
  proxyPath: string;
  mountPath: string;
}
