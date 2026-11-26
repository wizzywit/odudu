# 0029 — A page's headers have one authority

**Status:** Accepted · 2026-09-18

## Context

Every HTML page Odudu renders to an end-user is supposed to leave through
one function that sets its security headers. There were two.

`packages/protocol-oidc/src/view/html-response.ts`'s `sendHtml` derives the
Content Security Policy from the page's own declared script (ADR 0018's
amendment). `packages/account/src/view/verification-html.ts`'s
`sendVerificationHtml` hand-copied that policy, with a comment correctly
explaining why it could not import the first: `html-response.ts` is a
protocol package's internal, and no feature reaches into another's
internals (CLAUDE.md, Layering).

The two had already diverged. `sendVerificationHtml` sent
`referrer-policy: no-referrer`, defence in depth for the query-string
tokens the verification pages carry; `sendHtml` did not. Each exit was
correct on its own terms and incomplete against the other's, which is what
a hand-copy guarantees over time.

## Decision

The header set becomes a pure function, `pageHeaders`, in `@odudu/kernel`.
Every package's reply wrapper becomes two lines that spread its result over
a `FastifyReply` — `sendHtml` and `sendVerificationHtml` keep existing, but
neither owns the policy any more. `referrer-policy: no-referrer` moves onto
every page, not only the verification ones: no page is harmed by it, and
the tokens it defends are not unique to that feature.

`kernel` can hold this because the function is pure. `sendHtml` takes a
`FastifyReply`; `kernel`'s dependencies are `uuidv7` and `zod` only,
deliberately transport-free (verified:
`sed -n '/"dependencies"/,/}/p' packages/kernel/package.json`,
2026-09-18). Splitting the policy from the reply is what lets the policy
live where every package can reach it without adding `fastify` to the one
package everything depends on.

`html-response.test.ts` gains the rule this task exists to create: no
`*-html.ts` and no route file, in any package's view layer, names
`content-security-policy`, `x-frame-options` or `referrer-policy` — except
the two files that spread `pageHeaders`' result. A lint test that only
knows a name is present cannot verify a _value_, but a third hand-copy
cannot appear undetected either. `cache-control` joined the set in the
amendment below, and is guarded by a page being sent beside it rather than
by its name, since tokens, JSON and redirects set it legitimately.

## Consequences

- "One exit" is explicitly **not** what was promised. There remain two
  `send*` functions, because `FastifyReply` cannot live in `kernel`. The
  promise is one **authority**: both exits spread the same headers, and
  neither can drift from the other without also drifting from
  `pageHeaders`, which is unit-tested directly.
- A third package adding a rendered page writes its own two-line wrapper
  spreading `pageHeaders`, not a third hand-copy — the new exit test fails
  the build the moment it names a header itself instead.
- `kernel` stays transport-free. Every future header this policy needs
  (a new directive, a new page-level default) is a change to one function,
  reachable from every package without a new dependency edge.

## Amendment — 2026-09-28 — the console shell

The administration console's shell,
`packages/console-gateway/src/view/spa.ts`, is a static-serving
exception (the documentation is a second, below), and the third file `html-response.test.ts` lets name a page
header. It serves a built single-page app, not a server-rendered page: it
has no inline script and no per-request nonce, and its policy licenses a
self-hosted script and two style hashes: the `<style>` elements React
Aria's `usePress` injects everywhere and `usePreventScroll` injects on iOS
WebKit, which `packages/console-gateway/src/view/react-aria-style.test.ts`
recomputes from the pinned source. So it sets that fixed policy itself
rather than through `pageHeaders`, whose policy describes a markup-only
page. The two-wrapper rule above covers server-rendered pages; design spec
§5.4 (`docs/archive/specs/2026-09-26-p4d-admin-console-design.md`)
gives the shell's policy.

## Amendment — 2026-10-14 — a form left open, and Back

A login form was restored by the browser's Back button with its typed
username and a dead `auth_session_id`, and every resubmit failed the same
way. No page carried a `Cache-Control` header, so the browser showed its own
copy rather than asking `/authorize` for a fresh session.

**What the standards say** (checked 2026-10-13, cited by title because
numbering differs by version). No OAuth or OIDC specification requires a
cache header on the interactive login page; RFC 9700 gives no such rule
either, and this ADR does not claim one. `no-store` is normative on token
responses (RFC 6749 §5.1, OIDC Core §3.1.3.3) and a SHOULD on the logout
endpoints (OIDC Back-Channel Logout §2.8, Front-Channel Logout §2). The
recommendation for pages carrying session-bound state is anti-caching headers:
OWASP ASVS's anti-caching requirement (V8.2.1 in 4.0.x, V9.4 in 5.0) and the
OWASP Session Management and Web Cache Security cheat sheets. Mature
providers restart an expired sign-in instead of dead-ending (Keycloak's
timeout page links back to the start); that is practice, not a specification.
Chrome (developer.chrome.com/docs/web-platform/bfcache-ccns, 2025-09) now
restores `no-store` pages from the back/forward cache for up to three minutes
unless cookies change, so the header alone does not stop a restored dead form;
its advice is to reload on `pageshow` with `event.persisted`.

**Three layers, each needed.**

1. `pageHeaders` adds `cache-control: no-store` to every page it covers. One
   directive, not OWASP's cross-browser set: `Pragma` is deprecated
   (RFC 9111 §5.4), and `no-cache` and `Expires: 0` add nothing to a
   `no-store` that every current browser honours. Verified in Chromium:
   `apps/admin-console/e2e/restart-sign-in.spec.ts` goes Back from the refusal
   and gets a form under a new `auth_session_id`.
2. `reloadOnRestore` (`@odudu/kernel`) adds one `pageshow` script, on the
   page's own nonce so `script-src` is derived from the return value as
   above, reloading when `event.persisted`. Verified in Chrome: a form was
   restored from the cache with `persisted` true and its stale id, then
   reloaded under a new one. It is applied to the login form, account chooser
   and consent page when `/authorize` answers a GET, and nowhere else: a page
   that answers a POST would be re-sent by a reload, and the required-action
   pages issue secrets when rendered. The restored form shows for a moment
   before the reload, acceptable for a form and not for a secret. Playwright's
   Chromium has no back/forward cache, so this layer is covered by markup and
   policy tests and by the manual run above.
3. A submission whose authentication session is expired, consumed or unknown
   answers with the same refusal as before; when the row still exists (the
   reaper keeps it `ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS`, an hour
   by default, past expiry) the page adds "Start sign-in again", a path on this
   server rebuilt from the parked request, which `/authorize` validates
   afresh. The row authenticates nothing. `/authorize` now parks `max_age` on
   the fresh-login branch too: it had parked it only for the account chooser,
   so a rebuilt link lost it and was answered from an old session the
   original had refused. Every parameter `/authorize` acts on is rebuilt
   (`prompt`, `max_age`, the resolved `resource`, `claims`, `state`, `nonce`,
   PKCE); the server reads no other (`response_mode` other than `query` is
   refused, `request` and `request_uri` are refused), so none is dropped.
   A consumed session also yields the link, and that is safe: the id is the
   holder's own, the link carries only what the holder's own authorize URL
   already carried, and `/authorize` revalidates it.
4. A request that carried an `id_token_hint` or a `claims` `sub` cannot be
   rebuilt (the hint token is not stored, and a request without it is no
   longer tied to one subject), so the page offers "Return to the
   application" instead: an error redirect to the parked `redirect_uri`
   with `error=access_denied`, `state` and `iss`, built by the same
   `errorRedirect` the endpoint uses for its other refusals. RFC 6749
   §4.1.2.1 and OIDC Core §3.1.2.6 allow `access_denied` where the
   authorization server denied the request; the sign-in was not completed and
   nothing was granted. `login_required` is defined for a request that
   forbids interaction, which this was not. The relying party restarts with a
   hint of its own. It is offered only while the client is enabled and still
   registers that `redirect_uri`, so the target is validated twice, and never
   a URL the parked row did not carry. `response_mode` needs no handling:
   only `query` is accepted.

**A restored form reloading `/authorize`.** The reload re-requests the GET
that began the attempt. With a live SSO session that answers `302` to the
relying party again with the same `state`, issuing a new code. That is
acceptable: it is exactly what navigating to that URL does, the relying party
already handles a repeated callback (its `state` is spent), and nothing is
issued that the holder of the session could not obtain by opening the link.
Chrome also drops a `no-store` page from the cache when cookies change, which
a sign-in does, so the case is rare.

**What `no-store` costs.** Back to a sign-in page is a request, not a cache
hit: a person who goes Back sees a form fetched again and a new authentication
session row. Rows are reaped, so the cost is a write per visit on a path that
already writes one. Nothing hashed is affected: the console's assets under
`/console/assets/` stay cacheable. The console shell's `index.html` already
sent `no-store` and keeps setting it in `spa.ts` beside its own policy; that
file does not spread `pageHeaders`, so nothing changed there.

## Amendment — 2026-10-19 — a page may link one same-origin stylesheet and font

Every rendered page now links one stylesheet, `/instrument/instrument.css`
(`INSTRUMENT_STYLESHEET` in `@odudu/kernel`), which `@odudu/instrument`
builds from the console's tokens and serves from the server's own origin
along with the fonts it names. `pageHeaders` therefore adds three
directives to every page's policy, unconditionally:

```
style-src 'self'; font-src 'self'; img-src 'self'
```

They are not derived from the page, as `script-src` is, because every page
links the same sheet and the same mark; a directive that licenses nothing
stops describing the page, and a directive a page may or may not need would
fail silently for the page that forgot. `img-src 'self'` is for the mark
and the favicon, which are files, not `data:` URIs.

**What stays refused.** `default-src 'none'` is unchanged, so there is no
inline style (`'unsafe-inline'`, a `style` attribute or a `<style>`
element), no remote stylesheet, font or image, no `data:` source and no
`@import`. A test holds the whole header set to its exact value for a
markup-only page, so nothing but these three directives has moved, and a
scan of every view layer holds `pageHeaders` to being the only place a
directive is named. `build.test.ts` in `@odudu/instrument` fails the build
on a remote `url()`, an `@import` or a `data:` URL in the stylesheet.

**Why the stylesheet URL is stable and revalidated.** Pages link a fixed
path, so the sheet cannot carry a content hash. It is sent with a strong
`etag` and `cache-control: no-cache`: a browser asks again each time and
gets `304` unless the sheet changed, so a release never leaves a page
styled by last release's sheet. The fonts are named by their content
(`<name>.<hash>.woff2`) and sent `public, max-age=31536000, immutable`, as
the console's hashed assets are. The pages themselves stay `no-store`.

**A page still works without it.** CSS is an enhancement: no page depends on
a style for meaning, so a page whose stylesheet is refused, absent or slow
is plain, usable markup. The routes answer `404`, never a throw, when the
directory is missing at boot, and log a warning naming
`ODUDU_INSTRUMENT_DIR`.

**What this costs.** One more request per first visit, small beside the
page (the sheet is under 12 KB gzipped; the browser fetches only the font
faces a page uses, by `unicode-range`). The directory read at boot is
bounded by `readStaticTree`'s limits.

**`x-content-type-options: nosniff`.** `pageHeaders` sends it on every page,
and the console shell, its assets and `/instrument/*` send it too: a response
is the type it was served as, which matters once a stylesheet and fonts are
fetched from the same origin as the markup.

## Amendment — 2026-10-19 — the built documentation

`packages/web-assets/src/view/docs-routes.ts` is the second static-serving
exception and the fourth file `html-response.test.ts` lets name a page
header. It serves the built documentation (`apps/docs`, image target, base
`/docs/`) from the server's own origin at `/docs/`, read once at boot into a
manifest the way `spa.ts` reads the console: a path that is not an exact key
is `404`, so traversal, encoded separators, NUL and symlinks all end at the
same lookup, and a tree past 5,000 files or 96 MiB makes `/docs/*` answer
`503` with a log line naming `ODUDU_DOCS_DIR` and `ODUDU_DOCS=false`. The byte
bound began at 64 MiB and was raised when the built site passed the four fifths
of it that `image-fits-server.test.ts` keeps free.

**The policy is computed at build time, not by `pageHeaders`.** The site is
Docusaurus, which is not strict-CSP clean: each page carries one inline
script (the colour-mode initialiser, the same on every page of a build) and a
few `style=` attributes (the code blocks' theme colours and a hidden icon
sprite), and no `<style>` element. `apps/docs/scripts/csp.ts` hashes each
inline script and each style attribute value into `csp.json` beside the site,
and `docsPolicy` (`packages/web-assets/src/service/docs-policy.ts`, pure)
makes the policy from it:

```
default-src 'self'; script-src 'self' <script hash>; style-src 'self';
style-src-attr 'unsafe-hashes' <style attribute hashes>; img-src 'self' data:;
font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none';
frame-ancestors 'none'; base-uri 'self'; form-action 'none'
```

`object-src` and `frame-src` are closed because the site embeds no plugin
content and frames nothing; workers fall back to `default-src 'self'`.

**Why `'unsafe-hashes'`, and what it licenses.** A style attribute is
licensed only by a hash with `'unsafe-hashes'`, and only `style-src-attr`
carries it: a `<style>` element or an `@import` stays under `style-src
'self'`, and `'unsafe-inline'` is nowhere. The seven values are the
Prism code-block colours (`color:#393A34`, `--prism-color:…;--prism-background-color:…`,
`color:#393A34;background-color:#f6f8fa`, `color:#36acaa`, `color:#e3116c`),
`display:inline-block` and the theme's `display: none;` on its icon sprite;
each hash licenses that exact string on any element, which is why the list is
short and why `csp.ts` refuses a page with a `<style>` element, an `on*`
attribute or a `javascript:` URL, which no hash in this policy covers.
`img-src data:` is the theme's chevron, menu and copy-button icons.
`csp.test.ts` recomputes both lists from the HTML, and a Chromium walk under
the header the route sends (navigation, search, the colour toggle, code copy,
the mobile menu at 390 px) fails on any `securitypolicyviolation`, because a
style or script made at run time is in the JavaScript and not the HTML.

**The route says noindex on every response it produces.** `x-robots-tag: noindex,
nofollow` on the page, a hashed asset, a `404`, a `308`, the search index, the
Markdown copies and `llms.txt`, beside `x-content-type-options: nosniff`,
`x-frame-options: DENY`, `referrer-policy: no-referrer` and `content-language`.
That is every response the route's handlers produce. Two kinds are Fastify's
own and carry none of these headers: the `400` for a malformed percent-escape
or a byte Node refuses, and the `404` for a method other than `GET` or `HEAD`
(both `application/problem+json`, no markup). Wrapping them would need a hook
on the root instance, which touches every other route, so they are left. A
private install never competes with the public site; the build's own
`<meta name="robots">` is an independent second signal. The fixed policy is on
every response, not only on HTML, so an SVG opened as a document is held too.
Pages and unhashed files revalidate by etag (`no-cache`); a file named by its
content under `assets/` is `immutable`.

**A path prefix is unsupported.** The site's links name `/docs/` and its
search index is fetched from `/docs/search-index.json`, so the server must be
at the root of the origin `ODUDU_PUBLIC_BASE_URL` names. A reverse proxy that
mounts it under `/idp/` breaks every link and asset of the documentation (and,
for the same reason, the console and the issuer). The README's Deploying section says so, and the
operating section's Deploying page will state it with a test beside it.
The route never builds an address from `Host` or a forwarded header, and a
test holds that no response names one.

**Two copies, two versions.** The hosted copy under `/odudu/` is built from
the latest release; the image's copy is built from the commit the image is,
and matches its version. The image's pages link to neither the hosted copy nor
any origin but the repository.

## Alternatives rejected

- **Move `sendHtml` itself into `kernel`.** Would add `fastify` as a
  dependency of the package every other package depends on, for the sake
  of a two-line wrapper that already fits in the packages that need it.
- **A new `@odudu/web` package.** One function does not justify a package;
  `RenderedPage`, the type this function already consumes, lives in
  `kernel`.
- **Leave both exits and document the duplication.** This is the state
  the codebase was already in — a correct comment explaining why the
  duplication existed did not stop it from drifting.
