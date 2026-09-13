# 0018 — Framing defence on the pages Odudu renders

**Status:** Accepted · 2026-09-13

## Context

RFC 6749 §10.13 obliges the authorization server to defend the pages it
renders to the end-user against framing. The attack is concrete: an
invisible overlay over a framed sign-in form harvests the credentials, or
the click that grants authorization, while the end-user believes they are
using the attacker's page.

Odudu renders exactly three kinds of page — the login form and the
authorization error pages — all of them through one function
(`packages/protocol-oidc/src/view/html-response.ts`). There are two headers
that describe framing, and they do not describe it equally well.
`X-Frame-Options` only ever described the _immediate_ parent, and its
`ALLOW-FROM` form was never interoperable and is obsolete. CSP's
`frame-ancestors` is defined over the entire ancestor chain, so a page
framed by a same-origin document that is itself framed by an attacker is
still refused; it is also the mechanism still being specified and extended.

## Decision

Send both, from one place, on every page.

`frame-ancestors 'none'` is the countermeasure. `X-Frame-Options: DENY`
rides alongside it rather than instead of it: every user agent that
implements CSP honours `frame-ancestors` and, where both are present,
ignores `X-Frame-Options`, so the older header is only ever read by agents
with no CSP at all. `DENY` and `'none'` say the same thing, which is the
one pairing where `X-Frame-Options`' missing ancestor-chain semantics
cannot make the two headers disagree.

The rest of the policy is small because these pages are: markup only, no
script, no stylesheet, no image, no frame of their own.

- `default-src 'none'` describes them exactly, so a subresource added later
  breaks visibly instead of quietly widening what injected markup could
  reach.
- `form-action 'self'` keeps the login form posting to this origin.
- `base-uri 'none'` stops an injected `<base>` re-targeting that relative
  action.

The last two narrow the blast radius of an escaping failure in
`authorize-html.ts`; they do not duplicate its escaping, which remains the
actual defence against injection.

Routes never set a content type for HTML themselves. They call `sendHtml`,
so the headers cannot be forgotten on a page added later, and
`html-response.test.ts` holds the view layer to naming the HTML media type
nowhere else.

## Consequences

- Adding a stylesheet, script or image to a rendered page is a deliberate
  act that requires widening `default-src` — a visible break, which is the
  intent.
- Odudu's rendered pages can never be embedded, including by an operator
  who wants to frame the login form inside their own portal. That is the
  requirement, not a limitation to design around.
- Two headers say one thing, and a future reader may be tempted to drop the
  obsolete one. The pairing is only safe because `DENY` and `'none'` agree;
  if the CSP ever gains a permitted ancestor, `X-Frame-Options` must be
  removed in the same change rather than left to disagree.

## Alternatives rejected

- **`frame-ancestors` alone.** Correct for every agent that implements CSP,
  and silently absent for one that does not. `X-Frame-Options` costs one
  header and closes that gap.
- **`X-Frame-Options` alone.** Describes only the immediate parent, so a
  nested same-origin frame defeats it, and its `ALLOW-FROM` form is
  obsolete.
- **Per-route headers.** One forgotten page is the whole vulnerability, and
  a header set at five call sites is a header that will eventually be set
  at four.
