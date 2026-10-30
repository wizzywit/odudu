# 0030 — A theme replaces a body, not a document

**Status:** Accepted · 2026-09-18

**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.

## Context

P4b's exit criterion lets a tenant's administrator — an operator of the
tenant, but not of Odudu itself — supply branding for the pages their
End-Users see: a logo, a palette, copy. That branding has to reach pages
`protocol-oidc`, `account` and `authn-flows` render today as a single
`html` string per `RenderedPage` (ADR 0029), with no seam a theme could
attach to.

Whatever seam is chosen has to survive the fact that the branding comes
from a tenant, which this server does not otherwise trust with markup: a
tenant's administrator is closer to an untrusted client than to an operator
of the identity provider. The login form's password field, the CSP nonce a
WebAuthn page carries (ADR 0018's amendment), `frame-ancestors 'none'`,
and the hidden `auth_session_id` or `session_id` that CSRF-protects a
submission all live in pages a theme will style. A seam that hands a theme
the document hands it those along with the branding.

## Decision

`RenderedPage` grows two fields beside `html`: `body`, everything a
document's `<body>` holds, and `title`. A renderer keeps assembling `html`
exactly as it does today — the document a real client is sent — and now
also returns the fragment and title a theme is allowed to see. P4b
substitutes a themed shell around `body`, without a renderer changing.

`protocol-oidc` gets one document shell, `packages/protocol-oidc/src/view/document.ts`'s
`page(title, body, script)`, so its eight renderers stop hand-assembling
`<!doctype html>…</html>` and return `page(...)` instead — boilerplate
moves, no renderer's markup changes. `account` and `authn-flows` get the
same treatment in a later task; until then `pageHeaders` keeps accepting
`string | RenderedPage`, so a package mid-migration does not break the one
that has finished.

The contract is decided here, in P3a, and delivered in P4b. P3a is where
every renderer this server has already exists and can be shaped once,
under one review; P4b is where the theme that consumes the shape ships.
Deciding the seam without a consumer risks guessing wrong about what a
theme needs; building the seam and the consumer in the same phase risks
shaping the contract around one theme's convenience rather than the
constraint that has to hold for every theme. Fixing the contract first and
proving it against a real theme second is the order that catches a bad
guess before eight renderers, then more, depend on it.

## Consequences

- A theme can reorder, relabel, restyle and re-brand everything inside
  `body` — which is most of what branding is — without ever holding the
  password field, the nonce, or the framing defence.
- `html` stays on the interface, unchanged in shape and content: every
  caller that reads `.html` today — `sendHtml`, `sendVerificationHtml` —
  keeps working exactly as it does, through this task and through P4b.
- A page that needs a script continues to name its nonce through
  `PageScript`, on the `RenderedPage` that also carries `body` — a theme
  substituting the shell around `body` cannot separate the nonce from the
  markup that declares it without breaking the CSP the page is served
  with, which is the property ADR 0018's amendment exists to protect.
- A ninth renderer, or a renderer in `account` or `authn-flows` once Task 4
  lands, is written against `page()` (or that package's own copy) from the
  start rather than assembling a document by hand, the same way ADR 0029
  put the header set behind one function instead of a second hand-copy.

## Amendment — 2026-10-19 — what the shell owns

The shell now carries the stylesheet link, the favicon, the viewport and
colour-scheme metas, `lang` and `dir`, the Instrument mark and one `<main>`
around the page. `body` is what a renderer passed in, not everything the
document's `<body>` holds: a theme replacing it keeps the shell's chrome
and styling, and never receives a `<link>`, `<html>` or the mark to drop.
Every package's `page()` has this shape, and
`packages/protocol-oidc/src/view/instrument-reach.test.ts` fails the build
on a `*-html.ts` that builds a document of its own.

## Amendment — 2026-10-27 — a branded page's policy

A page whose locale carries a `ResolvedBranding` lists the theme's own
stylesheet and image URLs in `style-src` and `img-src` as `origin + path`,
in place of `'self'`. `origin` must equal the origin the page is served from
(the configured public base URL); a mismatch fails closed, the page loading
unstyled while its forms still work. A URL ending in `/` is refused, because
a trailing slash is a prefix match in a CSP. A URL with `//` or a dot segment is refused too, as it never matches a request path. An origin over 300 characters is refused. `pageHeaders` throws on an
invalid branding, so a resolver calls `brandingProblems` first and, on any
reason, logs it and falls back to the default theme.

## Alternatives rejected

- **A theme replaces the whole document.** Rejected: P4b's criterion is
  that an _untrusted_ client — a tenant's own administrator — supplies the
  styling. A theme that can replace the document can replace the password
  field, the CSP nonce a script's policy is keyed to, `frame-ancestors`,
  and `form-action`, which is not a branding surface, it is the page's
  security boundary.
- **A theme supplies only a stylesheet.** Rejected: a stylesheet cannot
  reorder a form's fields, relabel a button, or drop a paragraph a tenant
  does not want shown — and reordering, relabelling and trimming copy is
  most of what a tenant asking for its own branding actually wants. A seam
  that only accepts colours and fonts would not meet P4b's criterion.
