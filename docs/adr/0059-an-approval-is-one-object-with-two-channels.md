# 0059 — An approval is one object with two channels: a console card and CIBA

**Status:** Accepted · 2026-11-24

## Context

Three things need a person to say yes to one action the agent proposed: P5b's
withheld tool classes (the umbrella spec names CIBA through P5), the console assistant's
writes (P5c), and any outside agent that uses CIBA directly. OpenID CIBA (poll mode)
is the standard for the out-of-band case: the client asks, the person is told and
approves on a separate channel, the client polls. Auth0 documents the same pattern for
agents. The console assistant has the person in front of it, where a card in the chat is
the natural channel and a mailed link is a poor one.

## Decision

**An approval is a row in `agent_approvals`** with the subject, the requesting client or
instance, a human-readable summary, a digest of the exact action, a state (pending,
approved, denied, expired) and an expiry. It authorises exactly one action, once, before
it expires.

**Two channels write the decision, and both need the person:** CIBA's approval page
(server-rendered, the person's own session, a CSRF-protected POST, reached from a mail
carrying only the approval id) and the console's approval card (the person's
authenticated request). No credential a client or the agent holds can move an approval
out of `pending`.

**CIBA is built in P5 in poll mode only,** with `login_hint` and `id_token_hint`,
`binding_message`, a capped `requested_expiry`, the standard error codes and rate
limiting per request. `ping`, `push`, `user_code`, signed requests and rich
authorization requests are not built and discovery says so.

## Consequences

- P5b, P5c and an outside agent share one object, one audit vocabulary and one expiry
  rule.
- The door's acceptance of an approved action for a withheld tool is P5b's work, not P5's.
- Approval by mail trusts the mailbox as much as a password reset does; the page states
  the agent and the action.

## Alternatives rejected

- **MCP elicitation as the confirmation step.** The server asks the client, which an
  injected agent could answer itself.
- **A step-up scope and consent at sign-in.** It is a person, but not a person looking at
  one call.
- **CIBA only, even in the console.** A mailed link for a person already in the chat.
- **A separate approval object per consumer.** Three vocabularies and three expiry rules
  for the same decision.
