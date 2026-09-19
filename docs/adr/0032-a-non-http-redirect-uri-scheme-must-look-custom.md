# 0032 — A non-HTTP redirect_uri scheme must look custom

**Status:** Accepted · 2026-09-19

## Context

RFC 7591 §5's third bullet permits a registered `redirect_uri` to be "a
non-HTTP(S) URI Scheme URL, such as an application-specific URL scheme
that will result in the client being invoked" — the native-app deep-link
form. `isValidRedirectUri`'s non-HTTP branch, before this decision,
accepted any scheme at all so long as the URL carried a path, a query or a
non-empty host: `javascript:alert(1)`, `data:text/html,x` and
`file:///etc/passwd` all satisfied that check and registered as valid
redirect URIs, because each has a non-empty scheme-specific part.

None of those three is what §5 means by "application-specific" — they name
a browser-interpreted or filesystem scheme, not one a mobile OS routes to
an installed app. RFC 8252 §7.1 (OAuth 2.0 for Native Apps) gives the
convention such a scheme actually follows in practice: reverse domain
notation, e.g. `com.example.app:/oauth2redirect`, chosen specifically
because it needs no registry and collides with nothing a browser already
understands.

## Decision

A non-HTTP `redirect_uri`'s scheme must contain at least one `.`, checked
alongside the existing shape rule (a fragment refused, and — for this
branch — a non-empty path, query or host). No dangerous scheme in
practical use (`javascript`, `data`, `file`, `vbscript`, `blob`, ...) names
itself with a dot; every native-app custom scheme in the reverse-DNS
convention does by construction. `com.example.app:/cb` is accepted;
`myapp://cb` (dotless) is refused with `invalid_redirect_uri`, even though
authors use dotless custom schemes in the wild.

This is deny-by-default, not an enumerated denylist. A denylist of
dangerous schemes is a list that is wrong the day a scheme it did not name
turns out to be interpretable somewhere (a new browser feature, a new
handler an OS registers) — closing the class by requiring the one
syntactic marker every legitimate case already has is a smaller and more
stable rule than trying to enumerate every case that lacks it.

## Consequences

A client registering a dotless custom scheme (`myapp://cb`, `foo://cb`) is
refused, even though such schemes are common and harmless in practice —
Android and iOS both permit registering one. That refusal answers
`invalid_redirect_uri` with no further detail in the response body, so a
client author who hits it has to consult documentation to learn the
reverse-DNS requirement (`README.md` and `docs/request-paths.md`, updated
alongside this decision) rather than being told inline. Reworded to name
the requirement in the refusal is a smaller, separate change, left for
whoever next touches this error path.

`frontchannel_logout_uri` gets the same https/absolute/no-fragment policy
its back-channel twin already had (`isValidLogoutUri`, shared by both) —
not a new decision, but recorded here since it shipped in the same change:
the value is destined for an iframe `src` (P3b), the sink `javascript:` and
plain `http:` both reach if left unchecked.

## Alternatives rejected

**An enumerated denylist of dangerous schemes** (`javascript`, `data`,
`file`, `vbscript`, `blob`, `about`, ...). Rejected: the list is only as
good as what it remembers to name, and a new interpretable scheme (a
future browser feature, a platform-specific handler) would silently slip
through until someone thought to add it. The reverse-DNS requirement
instead states what a legitimate value looks like and refuses everything
else, so a scheme this decision's authors never considered is refused by
default rather than accepted by omission.

**Accepting any scheme with a non-empty scheme-specific part** (the
pre-existing rule). Rejected outright: verified by execution that
`javascript:alert(1)`, `data:text/html,x` and `file:///etc/passwd` all
pass it, registering a client whose "redirect" a browser would actually
interpret rather than merely hand to another app.
