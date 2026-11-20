import type { BffOptions, Handler, SessionStore } from '@odudu-io/bff';

// Who is signed in. The claims of their ID token and nothing else: the tokens
// stay in the store on the server.
export interface Session {
  claims: Record<string, unknown>;
}

export interface OduduHandlersOptions extends BffOptions {
  // The path of the catch-all route that the handlers are exported from, with
  // `/login`, `/callback`, `/logout`, `/session` and the proxy below it. It
  // includes the app's `basePath` when it has one. `/api/auth` when omitted.
  mountPath?: string;
}

// What a Next App Router route file exports, and the server-side read of the
// session, all on one BFF and so on one session store.
export interface OduduHandlers {
  GET: Handler;
  POST: Handler;
  PUT: Handler;
  PATCH: Handler;
  DELETE: Handler;
  // The signed-in person for a server component, a server action or a route
  // handler; null for no session. It writes no cookie, so it is safe where a
  // response can no longer set one.
  getSession: () => Promise<Session | null>;
}

export interface WithAuthOptions {
  // Paths that need a session, matched on whole segments: `/dashboard` covers
  // `/dashboard/settings` and not `/dashboards`. Pair it with the same list in
  // the file's `config.matcher`, so the function runs for these paths only.
  paths: string[];
  // The cookie the BFF was given; `__Host-odudu` when omitted.
  cookieName?: string;
  // Where an anonymous request is sent; `${mountPath}/login` when omitted.
  loginPath?: string;
  // The BFF's mount path, whose routes are never protected. `/api/auth` when omitted.
  mountPath?: string;
  // Without a store the function checks that the cookie is there and looks like
  // an id. With one it also asks the store whether that id is a session. It must
  // be the store the BFF was given: the default in-memory store lives in the
  // route handlers' module graph and is not visible from the proxy file.
  store?: SessionStore;
}
