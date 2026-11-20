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
  store?: SessionStore;
  // Must start with `__Host-`; the login cookie is `<cookieName>-login`.
  cookieName?: string;
  postLogoutRedirectUri?: string;
  // Origins whose browser pages may call the state-changing routes. Defaults
  // to the origin of `redirectUri`.
  allowedOrigins?: string[];
  // Where `callback` sends the browser afterwards; `/` when omitted.
  afterSignInPath?: string;
  // The longest a session is kept, whatever its use. 7 days when omitted.
  sessionTtlMs?: number;
  // Passed to the OIDC core: a fetch, a clock, `allowInsecureRequests`.
  deps?: Deps;
}

export interface Bff {
  login: Handler;
  callback: Handler;
  logout: Handler;
  session: Handler;
}
