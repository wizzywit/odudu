# 0034 — A page declares the origins it frames

**Status:** Accepted · 2026-09-20

## Context

Front-channel logout (OpenID Connect Front-Channel Logout 1.0) asks the OP
to render, on its own origin, one `<iframe>` per relying party that
registered a `frontchannel_logout_uri` and used the session being ended.
Every page Odudu renders carries `default-src 'none'`, which forbids a
frame along with everything else (ADR 0018), so this is the second time a
page needs more than markup — the first was the passkey pages' inline
script, and ADR 0018's amendment already named the failure mode that matters
here: a Content Security Policy refusal is invisible in the response. The
status is 200, the markup is intact, and the refusal is reported only in a
real browser's console. A page whose policy and markup disagree about a
script shipped inert with nothing to catch it; a page whose policy and
markup disagree about a frame fails exactly the same way, silently, and
only a browser would notice a relying party's logout iframe was never
allowed to load.

## Decision

`RenderedPage` grows `frames: readonly string[]` — the exact origins the
page's own markup embeds — and `pageHeaders`' `policyFor` derives
`frame-src` from that one value, emitted only when the list is non-empty. A
policy is never assembled beside the markup that has to agree with it: the
renderer that builds the `<iframe>` elements is the one place that can also
be trusted to say what it framed. Repeated origins are deduplicated before
they reach the directive — the list is built per relying party, and two
clients may register a logout URI on the same host, so a duplicate is
expected rather than exceptional.

`x-frame-options: DENY` is untouched. It governs this page being framed by
someone else's page, not this page framing others; the two directions do
not overlap, and folding framing-out into a header meant for framing-in
would weaken a defence ADR 0018 already established for an unrelated
reason.

## What is being accepted

A page loaded inside a frame can navigate the top-level window — a framed
document is not sandboxed against that by default. Framing a registered
`frontchannel_logout_uri` therefore hands that relying party's page a
top-navigation primitive for the duration this OP's logout page is on
screen. In a realm with anonymous dynamic client registration enabled, that
primitive is handed to a client nobody vetted. This is accepted, not
mitigated: the risk belongs to the front-channel logout mechanism itself,
which exists to let an RP run its own code as a reaction to the OP ending a
session, and removing the ability to run that code removes the feature.

`sandbox` (without `allow-same-origin`) is not the answer. It would remove
the top-navigation primitive, but it would also deny the framed document
its own cookies — and the RP's session cookie, sent with the framed
request, is the entire mechanism front-channel logout depends on to
identify which session to end. A control that disables the feature is not
a mitigation of it.

## What the spike found, and why this ships as an attempt

`docs/superpowers/p3b-spike-frontchannel.md` framed a cross-site logout
endpoint and measured, rather than assumed, what a real browser does with
the request: a cookie with no explicit `SameSite` — the ordinary,
spec-default case — never reaches a framed cross-site request at all, so
an RP has to opt in to `SameSite=None; Secure` on its logout cookie before
the OP's iframe has any chance of reaching it. Even an RP that opts in is
then subject to third-party-cookie policy, which the spike's browser
allowed by default but which Safari and Firefox deny by default, and which
Chrome lets a user or an administrator deny.

Two independent gates, either one enough to make the framed request
silently do nothing at the RP, and neither observable by the OP: the
iframe's response is never read back. This is why the phase promises the
**attempt** — render the iframe, name the RP correctly, carry every
parameter it would need — never delivery.

## Consequences

- A page that frames nothing pays nothing: no `frame-src` directive is
  added, so the CSP for the pages that predate this decision is unchanged.
- Every existing renderer now returns `frames: []` alongside `script:
null` or its script value — a page that adds a frame later widens that one
  array rather than assembling a directive beside its markup.
- The logout page's own use of `frames` (built from the session's front-
  channel logout URIs) inherits the deduplication and the derivation for
  free; it needs no policy logic of its own.
- Framing happens on both branches that render a page — the logged-out
  page, and the page a refused `post_logout_redirect_uri` renders instead
  of honouring it — and never on the redirect RP-Initiated Logout 1.0
  issues once a `post_logout_redirect_uri` matches. That is the common
  case, so a session ended with a redirect notifies no relying party by
  this mechanism at all today. Rendering the frames first and navigating
  afterward was not weighed against this: the question is open, not
  answered, and is tracked in `docs/NEXT.md`'s "Front-channel logout on a
  redirecting session end" — P3b closes without picking it up, so it
  passes to whichever phase's trigger fires there, rather than being
  something this decision closed.

## Alternatives rejected

- **Assemble `frame-src` in the route or usecase that builds the logout
  URLs, beside `frame-ancestors` and the rest.** The alternative ADR 0018's
  amendment already rejected for scripts, for the same reason: two call
  sites that must agree are two chances to disagree, and disagreement here
  fails silently in exactly the same way.
- **`sandbox` on the iframe instead of a frame-src allowlist.** Removes the
  RP's cookies along with the top-navigation primitive, which removes the
  mechanism rather than securing it.
- **Refuse to frame third-party origins at all, and rely on back-channel
  logout alone.** Would satisfy the security concern completely but is not
  a decision this ADR can make — front-channel logout is the phase's
  requirement, back-channel is a separate delivery path, and neither
  substitutes for the other.
