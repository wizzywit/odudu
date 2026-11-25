# 0055 — The open product ships the console assistant, behind the operator's own key

**Status:** Accepted · 2026-11-24

## Context

The amendment of 2026-10-16 to [ADR 0042](0042-distribution-licensing-and-the-paid-boundary.md)
kept the assistant out of the open product: no chat surface, no stored AI provider
key, and a bring-your-own-key panel "reopened only if users ask for it". The owner
has reopened it. An assistant that administers a tenant through the tools the MCP
server already offers is what makes the product easy to adopt, and it sets Odudu
apart from identity providers that only expose an API to someone else's assistant.

## Decision

**The open product ships the assistant:** a chat panel in the console, a loop that
calls the admin API's tools as the signed-in administrator's agent, buttons in the
console's screens that start it with that screen's context, and a budget on what it
spends. It works with a model provider the operator configures with their own key.

**With no provider configured there is no assistant.** The server reports it as off,
the console renders no AI element, and every other behaviour is as it is today. The
MCP endpoint for an administrator's own client is unaffected either way.

**The paid layer stays the managed assistant:** no key to bring, tier limits,
proactive and scheduled work that needs an always-on service, whole-tenant
configuration review, audit anomaly detection and policy suggestions. It plugs in
through extension points added to the open product first (ADR 0042), and the open
assistant never depends on it.

**The boundary is per object, on demand and started by a person, versus whole tenant,
scheduled and proactive.** "Review this client" and "explain this audit event" are
open. A scheduled review of every client, and a digest of anomalies, are paid.

**The assistant is an agent principal like any other.** The same capability ceiling
(ADR 0040), the same audit trail, the same door (ADR 0050). It has no side door.

## Consequences

- ADR 0042's amendment of 2026-10-16 is superseded in its paragraph on a built-in
  assistant and a key panel; its decision on the MCP server stands (0042 carries a
  pointer here).
- Odudu now holds a provider key and sends tenant data to a third party. The key is
  the operator's, set in the environment (ADR 0015), never reaches a browser, and is
  never written to the audit trail or a log. Enabling the assistant states plainly
  that data goes to the provider.
- A conversation is data about an administrator's work; its retention, deletion and
  visibility are settings with stated defaults (ADR 0058), not a table's accident.

## Alternatives rejected

- **Keep the assistant paid and ship only the MCP server.** An evaluator who wants to
  try administration by conversation must first set up an external client, and the
  adoption argument is lost.
- **Ship it with a key Odudu holds.** Odudu would resell model access with a spend it
  cannot bound for a self-hoster.
- **Ship the loop and no chat surface.** The loop is the part nobody sees; the surface
  is what people adopt.
