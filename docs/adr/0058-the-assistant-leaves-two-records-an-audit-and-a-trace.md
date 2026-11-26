# 0058 — The assistant leaves two records: an audit trail of what happened and a trace of why

**Status:** Accepted · 2026-11-24

## Context

The owner wants to see everything the assistant does and to investigate it when it does
not behave as expected. Odudu's audit trail already records one `agent.tool_call` row
per agent tool call, reads included, because an agent acts on text it reads (ADR 0040,
amendment of 2026-11-05), and the call is refused if the row cannot be written. That
row holds digests, not text, and the table is built for 100 million events.

Investigating a model needs what the audit row must not carry: prompts, tool inputs and
outputs, which model was chosen and why, token usage per step, and provider request ids.
That content is sensitive, bulky and needed for days, not years.

The AI SDK emits lifecycle events (model call, step, tool start and end, errors,
aborts) and OpenTelemetry spans (`@ai-sdk/otel`), so the instrumentation need not be
written (`verified:` the telemetry documentation in `ai@7.0.181`).

## Decision

**Two records.** The _audit trail_ is rows in the existing `audit_events` table with
allowlisted detail and no message text, kept as long as other audit rows:
`assistant.turn`, `assistant.approval`, `assistant.budget`, `assistant.config`, and
`agent.tool_call` carrying the conversation and turn ids. The _trace_ is tenant-scoped
tables (conversations, turns, steps, events) holding the content, with a configurable
short retention (default 30 days) removed by a command-first reaper (ADR 0024).

**One recorder feeds the trace:** a `Telemetry` integration receives the SDK's events,
and our own hooks add the decisions the SDK cannot see (slot chosen and why, budget
reservation, tool narrowing, approval outcome, history trimming), all under one turn id,
with sub-agents nested under the step that spawned them. OpenTelemetry output goes to
the operator's collector with content off by default.

**Boundary rules.** A tool call or turn whose audit row cannot be written does not run.
No tool exposes the assistant's own audit or trace to the agent, and the agent cannot
switch auditing off or change its own budget or mode. A tool result that carries a
one-time secret or key material (a `client_secret`, a signing key) is masked before the
trace stores it, so the activity screen never replays one; P5b enables a credential-class
tool only once that masking is tested for it. A conversation is visible to
people holding `read-assistant-activity`; the panel says so, and a tenant can restrict
a conversation to its author. A person can flag a turn, which keeps that conversation
past retention.

## Consequences

- Row volume stays within the 100M-event design: one row per turn and per approval, not
  per model call.
- Content has its own retention and capability, separable from the audit trail.
- Investigation has a screen and an export to a regression test (promptfoo).

## Alternatives rejected

- **Everything in the audit row.** It would make the audit table carry prompts and
  outputs: sensitive, bulky, and retained for years.
- **OpenTelemetry only, to the operator's collector.** A self-hoster with no collector
  could see nothing, and tenant scoping and capabilities would be left to the collector.
- **Our own instrumentation.** The SDK emits the events; writing them again is the
  duplicate work this phase was asked to avoid.
- **A hash-chained, tamper-evident log.** Valuable, and not asked for; recorded as a
  possible later hardening.

## Amendment: the person may delete, and deleting touches no audit row

Decided by the owner on 2026-11-26. The trace is not a record the person is kept from:
the owner of a conversation can export it and delete it. Deleting removes the messages,
the trace and the approval cards and leaves a tombstone (ids, owner, times, who deleted
it, counts and an HMAC of the messages under a key derived per tenant from the KEK) and
an `assistant.conversation_deleted` audit row, in one transaction. The audit rows that
say a turn happened and what an approval changed stay, with the same retention as ever:
content and audit retention are independent, and a delete or an expiry never reaches
the audit table. A reported conversation cannot be deleted by its owner. Auditors read
metadata always and text only where the tenant sets `assistant_auditor_visible`, which
defaults to off; every read of text by someone other than the owner is
`assistant.text_read`, and no operator or system-tenant path reads a tenant's text. The
digest confirms a copy of the text to a holder of the key and is not evidence of what
was said; the conversation's text itself is mutable and is not tamper-evident, which the
documentation says. Rejected: archive only (an administrator pastes secrets and subject
emails into a chat and needs a way to remove them, and an erasure request needs a
remedy); an unkeyed hash on the tombstone (a confirmation oracle for short text).
