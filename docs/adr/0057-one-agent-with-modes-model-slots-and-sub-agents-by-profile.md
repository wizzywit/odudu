# 0057 — One agent, with modes, model slots and sub-agents chosen by task profile

**Status:** Accepted · 2026-11-24

## Context

An assistant can be one agent, a router over specialised agents, or an orchestrator
spawning sub-agents. A person can be shown none of that, a choice of mode, or a choice
of agent. Anthropic's guidance is to take the simplest design that works and add
agentic structure only where it earns its cost, and it reports that multi-agent
systems use roughly three to ten times the tokens of a single agent for the same task
(duplicated context, coordination and hand-offs). Tokens are what this product budgets
(ADR 0056) and a self-hoster pays for. The AI SDK documents when a sub-agent pays:
exploring large amounts of tokens, parallel independent reads, and isolating tool
access, and when it does not: simple, focused or sequential work.

The owner asked that the assistant solve anything the console can solve, cost-
effectively, using sub-agents where a flow needs them and a single agent otherwise,
with models chosen by difficulty.

## Decision

**One agent loop and one tool catalogue.** A screen's button starts the same loop with
that screen's context and a _task profile_.

**A task profile is data:** mode, model slot, tool subset, whether a sub-agent is
allowed, required or never, a step cap and a token cap. Specialisation is a fixture,
tested like any other.

**A person chooses a mode, not an agent:** Ask (reads only, the default) or Act (reads,
and writes that wait for approval). A mode narrows tools and never widens them past
what the owner's token and the door allow.

**Models fill three named slots:** fast (titles, summaries, sub-agent reads), standard
(the loop), deep (planning and hard reasoning). The operator maps slots to providers
and models. Free chat starts on standard and escalates to deep after a failed step or
on request. A person sees a model picker only when the operator allowed more than one
standard model.

**A sub-agent is a child agent instance of P5** (narrower scopes, a share of the
parent's budget, one question, one summarised answer). It is used where the profile
requires one, or allows one and a result would otherwise be large; a profile that says
`never` has none whatever the size. It is never the default shape.

**Routing is rules plus escalation,** not a trained router. Evals decide whether more
is needed.

## Consequences

- The simple case is cheap and its cost predictable enough to put a meter on.
- A tier can limit modes, models, slots and tool classes without changing the loop.
- A sub-agent is an identity, so its authority, budget and audit lineage are P5's
  invariants, not a second mechanism.

## Alternatives rejected

- **A multi-agent system from the start** (a router, an audit agent, a client agent, a
  flow agent): three to ten times the spend, harder to explain in the activity feed,
  and a hand-off is where context and authority leak.
- **A user-visible agent gallery:** it asks a person to know which agent fits a task,
  which is what the assistant is for, and it multiplies the surface the injection suite
  must cover.
- **One model for everything:** every title and summary billed at the loop's price.
- **A trained or classifier router (for example RouteLLM, which is Python):** the
  classifier call costs tokens and adds a service, for a gain nobody has measured here.
