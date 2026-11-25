# 0056 — The AI SDK runs the agent loop; Odudu owns what it decides in the hooks

**Status:** Accepted · 2026-11-24

## Context

The assistant needs a loop (model, tool call, result, repeat), several model providers
(the owner's Amazon Bedrock account first, then Anthropic, OpenAI and others),
streaming to the console, and tool calls that stop for a person's approval. Four
things in that loop are Odudu's own contract: a token budget checked before each model
call, the approval step, the audit row per tool call, and tenancy (ADR 0009).

Versions, licences and dependencies were read with `npm view` on 2026-11-24
(`verified: npm view <package> version license dependencies`), and the SDK's behaviour
from the documentation shipped in the `ai@7.0.181` package.

## Decision

**The Vercel AI SDK (`ai` 7.x, Apache-2.0) runs the loop.** `ToolLoopAgent` provides
the step cap (`stopWhen`), per-step model, tool and message changes (`prepareStep`,
`activeTools`), tool approval statuses with a history-aware policy hook, a documented
sub-agent pattern, lifecycle telemetry and OpenTelemetry (`@ai-sdk/otel`). Its provider
packages (`@ai-sdk/amazon-bedrock`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, all
Apache-2.0) make a provider a configuration value.

**Odudu's code is what runs inside the hooks:** budget reservation in `prepareStep`,
settlement in the hook that fires when a model call finishes and the one that fires when
it errors or aborts (the last call of a turn has no later `prepareStep`), slot choice and tool narrowing, the approval policy in `toolApproval`
backed by P5's approval store, the audit row around each tool, and a `Telemetry`
integration that records the trace (ADR 0058).

**Only `@odudu/assistant` imports `ai`,** at an exact pinned version. The package's own
functions are the boundary the rest of the repository sees, so a major version of the
SDK is a change to one package.

`assumption:` the Bedrock provider accepts a bearer key through `apiKey` and
`AWS_BEARER_TOKEN_BEDROCK` (documented, not yet run); `experimental_toolApprovalSecret`
is stable enough to rely on, or is replaced by approvals we store and check ourselves;
`ai/test` exports mock models. A spike runs each before a task depends on it.

## Consequences

- Much less code than a loop of our own, and the loop is one other people run.
- The SDK has changed major versions quickly (v5 to v7 in about a year); pinning and one
  package of exposure is the cost control.
- Approval has one implementation, ours, expressed through the SDK's hook.

## Alternatives rejected

- **Our own loop and port, the SDK as an adapter only.** Proposed first, then rejected
  after reading the SDK's agent documentation: it already provides everything the loop
  needs and our four contracts fit in its hooks.
- **LangChain / LangGraph.js** (`langchain` 1.6, `@langchain/langgraph` 1.7, MIT). Its
  strength is durable graph execution and checkpointing; the checkpointer's tables would
  sit outside our schema, our tenant policies and the foreign-tenant probe rule, and our
  state is a conversation plus one pending approval. `@langchain/core` brings
  `langsmith`, a tracing client an identity provider would have to prove is off
  (`assumption:` tracing is opt-in by environment variable; not run).
- **Mastra** (`@mastra/core` 1.85, Apache-2.0). 94 MB unpacked, with its own HTTP stack
  (`hono`) beside Fastify (ADR 0004) and its own memory and workflow model.
- **OpenAI Agents SDK** (`@openai/agents`, MIT). Built for OpenAI; the provider swap
  that is a requirement here is what it makes hard.
- **Claude Agent SDK.** Custom licence text in the package (`assumption:` not
  OSI-approved, not read), runs Claude, ships a coding agent's tools.
- **LlamaIndex.TS.** Retrieval-first; we have no retrieval problem.
- **Our own adapters per provider, no SDK.** Full control and three tool-call
  translations to keep correct; the fallback behind the same package boundary.
- **OPA policy (`@ai-sdk/policy-opa`).** A second policy language beside the TypeScript
  capability ceiling.

## Amendment 2026-11-24: self-hosted models

A self-hosted model is a provider like any other: `@ai-sdk/openai-compatible`
(Apache-2.0, `verified:` `npm view`) points the same loop at any server that speaks the
OpenAI chat protocol, such as vLLM or Ollama, behind the same package boundary and the
same hooks. The decision above is unchanged. What the operator's server must support
(tool calling, streamed usage) and how a model earns a place on the supported list are in
the P5c design.
