# 0038 — The admin console and its gateway

**Status:** Accepted · 2026-09-27

## Context

P4c and P4e gave the admin API every route it needs; nothing a person can
look at drives it, and every operator task is a `curl` against `/admin/**`.
P4d builds that surface: a React application, `apps/admin-console`, and a
way for it to hold a session against Odudu without becoming a place a token
can be stolen from.

A single-page application that keeps its own access and refresh tokens —
in memory, in `localStorage`, or anywhere else the page's own JavaScript can
read — is exactly the shape RFC 10017 (OAuth 2.0 for Browser-Based
Applications) writes to move away from: any script that runs on the page
runs with the tokens. RFC 10017 recommends a backend component holding the
tokens instead, the browser talking to it over a session cookie. Odudu
already has a backend: `apps/server`.

## Decision

**A backend-for-frontend, not a token-holding browser client.**
`@odudu/console-gateway`, mounted by `apps/server` under `/console`, is an
OAuth client of Odudu like any other: it runs the authorization code flow
against `/authorize` and `/token`, and keeps the access, refresh and ID
tokens server-side, encrypted, keyed to an `HttpOnly` session cookie the
browser never reads. The console calls `/console/api/admin/*`, which the
gateway forwards to `/admin/**` in-process, attaching the bearer token
itself. No token, no `client_secret` and no PKCE verifier is ever sent to
the browser.

**The stack.** React 19.3, built by Vite as a static SPA the server serves.
TanStack Router for routes and search parameters, TanStack Query for server
data. React Aria Components, unstyled, for every interactive primitive. CSS
Modules over custom-property tokens for styling. Zustand for the small set
of UI-only stores the state table (spec §6.4) allows — toasts, the
unsaved-changes guard — never for server data.

### Rejected

- **Tailwind v4.** A utility class carries no design-token boundary of its
  own; CSS Modules over custom properties keep every token as a single,
  greppable source instead of a class name convention.
- **vanilla-extract.** Build-time CSS-in-TS buys type-checked style objects
  at the cost of a compiler step the workspace does not otherwise need; CSS
  Modules get the same scoping with plain CSS.
- **Next.js.** Brings a server runtime and a routing convention of its own
  into a workspace that already has one server (`apps/server`) and one
  router library (TanStack Router); the console is a static SPA, not an
  application that needs Next's server rendering.
- **React Router's framework mode.** Framework mode assumes it owns data
  loading and the build; the console's data lives behind TanStack Query and
  the gateway, and TanStack Router's own type-safe search-parameter handling
  is what the state table (spec §6.4) is built around.
- **An in-browser OAuth client.** The rejected half of the decision above:
  tokens in the page are tokens a compromised dependency can read. RFC 10017
  exists because of exactly this case.
- **A token-mediating backend** (a server that exchanges the code but hands
  the resulting tokens back to the browser rather than keeping them). Keeps
  the authorization code out of the browser but not the access token,
  leaving the theft surface RFC 10017 identifies unaddressed.

## Consequences

- The layer rule inside `apps/admin-console` is by path segment, folder or
  single file (spec §6.2): a layer a feature does not need does not exist,
  and every file is classified by its path alone rather than by a fixed
  five-file scaffold per feature.
- The React file-naming convention — `PascalCase.tsx` for a component,
  `useCamelCase.ts` for a hook, `camelCase.ts` for anything else — holds
  only inside `apps/admin-console`. The server keeps kebab-case; this ADR
  introduces no naming change outside the console.
- Every admin action the console performs is authorised twice: by the
  gateway's own session check and, on the forwarded request, by the admin
  API's existing `authorizeAdmin`. The console holds no authority of its
  own to lose.
- The gateway is a new package and a new pair of tables
  (`console_sessions`, `console_logins`) under row-level security, reaped
  alongside every other session-shaped row; it is more moving parts than an
  in-browser client, accepted for the theft surface it removes.
