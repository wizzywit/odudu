# P5c provider and SDK spikes

Run 2026-11-25 on macOS arm64, Node 24.15.0, in a scratch package outside the
repository. Every `result:` below is the output of a command that was run, or
says why none was.

## Packages and licences

Command: `pnpm view <pkg> version license`.

| Package                   | Version | Licence    |
| ------------------------- | ------- | ---------- |
| ai                        | 7.0.181 | Apache-2.0 |
| @ai-sdk/amazon-bedrock    | 5.0.147 | Apache-2.0 |
| @ai-sdk/anthropic         | 4.0.108 | Apache-2.0 |
| @ai-sdk/openai            | 4.0.123 | Apache-2.0 |
| @ai-sdk/openai-compatible | 3.0.94  | Apache-2.0 |
| @ai-sdk/otel              | 1.0.181 | Apache-2.0 |
| @ai-sdk/react             | 4.0.186 | Apache-2.0 |
| promptfoo                 | 0.126.0 | MIT        |

result: pass. Every licence is Apache-2.0 or MIT.

## SDK export names (ai@7.0.181)

Checked with `import * as ai from 'ai'` and the `.d.ts` files.

- `ToolLoopAgent`: a runtime export of `ai` (a class).
- `stopWhen`: not an export; an option of `ToolLoopAgent` settings and of
  `streamText`. Conditions are exports: `stepCountIs`, `isStepCount`,
  `hasToolCall`, `isLoopFinished`.
- `prepareStep`: not an export; an option, typed `PrepareStepFunction`
  (result type `PrepareStepResult`).
- `toolApproval`: not an export; a settings option, typed
  `ToolApprovalConfiguration`: either one function or a per-tool map of
  `ToolApprovalStatus` (`'approved' | 'denied' | 'user-approval' | 'not-applicable'`)
  or a function. Related exports: `lastAssistantMessageIsCompleteWithApprovalResponses`,
  `InvalidToolApprovalError`, `ToolCallNotFoundForApprovalError`.
- `Telemetry`: a type-only export (an interface of hooks such as `onStart`,
  `onStepEnd`, `onToolExecutionStart`, `onToolExecutionEnd`,
  `onLanguageModelCallEnd`, `onEnd`, `onError`). The runtime function is
  `registerTelemetry(...integrations)`; a per-call `telemetry` option takes
  `TelemetryOptions`.
- Also present: `createAgentUIStream`, `createAgentUIStreamResponse`,
  `convertToModelMessages`.

result: pass.

## Mock models

Command: `import * as t from 'ai/test'`.

Names: `MockLanguageModelV3`, `MockLanguageModelV4`, `MockProviderV3`,
`MockProviderV4`, `MockEmbeddingModelV3`/`V4`, `simulateReadableStream`,
`convertArrayToReadableStream`, `convertArrayToAsyncIterable`,
`convertReadableStreamToArray`, `mockId`, `mockValues`.

`MockLanguageModelV3` with a `doGenerate` returning
`finishReason: { unified, raw }` and nested usage objects worked through
`generateText`: text `hi`, `doGenerateCalls.length` 1.

result: `mock_models_from_ai_test` pass. Both V3 and V4 mocks exist; the
spike used V3 and did not check which version the installed providers return.

## React

The console pins react and react-dom 19.3.1 (`apps/admin-console/package.json`).
`@ai-sdk/react@4.0.186` declares peer `react ^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`.
A jsdom client render of `useChat` with `DefaultChatTransport` and a fake
`fetch` streaming a UI-message SSE reply ended with
`ready:user=yo|assistant=hello` under React 19.3.1.

result: `react_19_3_useChat` pass. Node 22 or newer is required by the package
(`engines`).

## OpenAI-compatible, streaming with a tool call

Script: `/private/tmp/claude-202959266/-Users-wep-WebstormProjects-odudu/e7206f77-f847-433e-9285-a7df79092c1e/scratchpad/i0a/compat.mjs <baseURL> <model> <includeUsage>`. A `ToolLoopAgent`
with one read tool, `stream()`, `stopWhen: stepCountIs(4)`.

Ollama 0.40.4 at `http://localhost:11434/v1`, model `llama3.2:latest`:

| includeUsage | tool calls | steps | stream parts                                                           | totalUsage                                        |
| ------------ | ---------- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| true         | 1          | 2     | tool-input-start/delta/end, tool-call, tool-result, text-delta, finish | inputTokens 274, outputTokens 25, totalTokens 299 |
| false        | 1          | 2     | same                                                                   | no token counts (empty detail objects only)       |

Observed: without `includeUsage: true` the provider reports no token usage, so
a token budget has nothing to count. The assistant must set it for every
OpenAI-compatible slot. Ollama also reported `cacheReadTokens: 62` on the
first call.

result: `openai_compat_streaming_tools_usage` (Ollama) pass.

vLLM: result: not_run. `vllm/vllm-openai-cpu:latest` (arm64) pulled, and with
`--shm-size=2g --enable-auto-tool-choice --tool-call-parser hermes
--model Qwen/Qwen2.5-0.5B-Instruct` the engine worker stayed in CPU graph
compilation from 21:31 to 21:52 without serving `/v1/models`. The first start
failed on the default 64 MiB `/dev/shm` (160 MiB required). The 30-minute
limit ended the attempt. Retry on a Linux host or with a GPU image; the spec's
vLLM claim (`--enable-auto-tool-choice`) stays an assumption until then.

## Bedrock

No key was available, so none of this was run.

result: `bedrock_bearer`: pass (model `eu.anthropic.claude-haiku-5-5`, region from the owner's env; one tool call, usage 924 in / 65 out).
result: `prompt_cache_bedrock`: pass. First call wrote 5,403 cache tokens, the second read 5,403 (10 uncached). A system prompt with `providerOptions.bedrock.cachePoint` must go through the `instructions` option: SDK 7 rejects a system message inside `messages`.

The owner runs, with a pinned Bedrock model or inference-profile id:

```text
cd /private/tmp/claude-202959266/-Users-wep-WebstormProjects-odudu/e7206f77-f847-433e-9285-a7df79092c1e/scratchpad/i0a
AWS_BEARER_TOKEN_BEDROCK=<key> AWS_REGION=<region> BEDROCK_MODEL=<id> node bedrock.mjs
```

The script prints `bedrock_bearer: pass` when the tool ran once, then the
usage of two calls that share a 900-repeat static system prefix marked
`providerOptions.bedrock.cachePoint`; the second call's
`inputTokenDetails.cacheReadTokens` above zero means the cache works.
`@ai-sdk/amazon-bedrock` reads `AWS_BEARER_TOKEN_BEDROCK` itself
(`dist/index.js`, `environmentVariableName`) and reads `providerOptions.bedrock.cachePoint`.
The scripts live in the scratchpad and are not committed; copy `bedrock.mjs`
and `package.json` to run elsewhere.

## Summary

| Field                                       | Result  |
| ------------------------------------------- | ------- |
| licences                                    | pass    |
| export names                                | pass    |
| mock_models_from_ai_test                    | pass    |
| react_19_3_useChat                          | pass    |
| openai_compat_streaming_tools_usage, Ollama | pass    |
| openai_compat_streaming_tools_usage, vLLM   | not_run |
| bedrock_bearer                              | pass    |
| prompt_cache_bedrock                        | pass    |

No provider failed, so goal 2 of the spec is unchanged.

## Gateway streaming (console gateway)

Read first: `packages/console-gateway/src/usecase/forward.ts` (resolve the
session, refuse a changed principal, take a fresh access token, call
`odudu.forward`, end the session on a 401 confirmed at the tenant) and
`adapter/odudu-client.ts` (`forward` calls `fastify.inject` and returns
`res.rawPayload`, so the whole body is buffered). The CSRF guard is an
`onRequest` hook on the gateway instance (`view/csrf-guard.ts`), so it runs
before any route, a streaming one included.

Command: a scratch script with two Fastify instances (an "admin API" that
writes four chunks 200 ms apart, and a gateway whose stub `forwardStream`
calls `inject({ payloadAsStream: true, signal })` and sends `res.stream()`),
run with Node against `fastify@5.12.8` and `light-my-request@6.6.0`:

```text
no cookie -> 401
first chunk "chunk0" after 12ms (upstream lasts ~800ms)
upstream response closed at 902ms (writableFinished=false)
full read: 4 chunks, done after 822ms
browser abort sent at 909ms
upstream response closed at 915ms (writableFinished=false)
upstream stopped writing at chunk 1
```

- The first chunk reaches the browser after 12 ms while the upstream runs
  for about 800 ms, so the body is not buffered.
- A browser abort is seen by the upstream 6 ms later and the upstream stops
  writing at the next chunk. The gateway wires the reply's `close` (when the
  reply has not finished) to an `AbortController` whose signal is passed to
  `inject`.
- The cookie check, and any CSRF or tenant check placed in `onRequest` or in
  the use case, run before the upstream is called, as for `forward`. In the
  real use case the cookie's tenant half still scopes `resolveSession`, and
  `forwardStream` reuses `resolveSession`, `principalChanged` and
  `freshAccessToken` unchanged.
- `forward` stays as it is: its buffering, `bodyLimit` and 401 handling are
  what 163 admin routes depend on. The 401 check can run on the status line
  before the first chunk is piped; a stream is never retried and never
  refreshes a token mid-flight.
- Needs a port method that returns a stream (`OduduPort.forwardStream`)
  beside `forward`, implemented with `payloadAsStream` and `signal`.
- **Correction, found building the chat route.** An abort signal passed to
  `inject` destroys only the reading side of the call. It did not reach the
  upstream handler's `reply.raw` `close` (an upstream handler observing
  `close` with `writableFinished` false never saw it), so the figure above for
  the upstream stopping rested on the stub's own writes failing. The gateway
  therefore also destroys the upstream response itself, `res.raw.res.destroy()`,
  when the browser goes (`forwardStream` returns it as `destroy`); with that
  the handler sees `close` and aborts its model call. Tested in
  `odudu-client.test.ts`, `forward-stream.test.ts` and `proxy.test.ts`.
- `writableFinished=false` on the upstream's own close after a complete
  read is how `light-my-request`'s response reports it; the four chunks and
  the end arrived, so it is not an abort.

| Field                            | Result                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| stream_route                     | sibling                                                                  |
| first_chunk_before_upstream_end  | pass                                                                     |
| browser_abort_reaches_upstream   | pass                                                                     |
| session_csrf_tenant_checks_apply | pass (hook runs before the pipe; session and tenant by `resolveSession`) |
| inject_supports_streaming        | pass (`payloadAsStream`, `signal`)                                       |

# P5c engine spikes: approvals, telemetry, input estimates

Run 2026-11-25, `ai@7.0.181`, Node 24.15.0, scripts in a scratch package
outside the repository. Approval and telemetry runs use `MockLanguageModelV3`
(no provider is involved in either); the estimate runs call Bedrock
(`eu.anthropic.claude-haiku-5-5`, 12 requests in all) and a local Ollama
`llama3.2` through its OpenAI-compatible endpoint (6 requests).

## Approval signing and resume

Source read: `ai/dist/default-stop-condition-D8PwkeWe.js`, `signToolApproval`
and `verifyToolApprovalSignature`. The signature is an HMAC-SHA256 of the
approval id, tool-call id, tool name and a digest of the input, keyed by
`experimental_toolApprovalSecret`; nothing is held in process memory.

Command: process A runs a `ToolLoopAgent` with `toolApproval: { create_thing:
'user-approval' }` and a secret, writes `[user, ...response.messages]` as JSON;
process B (a new `node`) reads that file, appends
`{ role: 'tool', content: [{ type: 'tool-approval-response', approvalId, approved: true }] }`,
builds a new `ToolLoopAgent` and calls `generate({ messages })`.

```text
A: {"finishReason":"tool-calls","parts":["tool-call","tool-approval-request"],"sigPresent":true,"pid":27756}
B same secret:     {"ok":true,"executed":1,"text":"done","pid":27800}
B other secret:    AI_InvalidToolApprovalSignatureError ... invalid signature   (executed 0)
B tampered input:  AI_InvalidToolApprovalSignatureError ... invalid signature   (executed 0)
B no signature:    AI_InvalidToolApprovalSignatureError ... missing signature   (executed 0)
B empty secret:    DataError: Zero-length key is not supported                  (executed 0)
```

The pending request is plain JSON (`type`, `approvalId`, `toolCallId`,
`signature`); the tool ran once, before the next model call, in the fresh
process.

result: `approval_secret_stable`: pass. The same secret verifies in a second
process; a different secret, an edited input or a removed signature is refused
before the tool runs. An empty secret throws, so a missing environment value
must stop startup rather than disable signing.
result: `resume_from_stored_messages`: pass. Persisted messages with a pending
`tool-approval-request`, a response appended, and a fresh agent continue the run.

## Telemetry

Command: integrations that record `onStart`, `onStepStart`,
`onToolExecutionStart`, `onToolExecutionEnd`, `onStepEnd`; one registered with
`registerTelemetry`, one passed as `telemetry: { integrations: [...] }`.

```text
{"A_perCall":7,"A_global":0}     both present, one tool-calling run
{"B_global_only":3}              no per-call integration: the global one receives events
```

Parent whose tool runs a child agent, both passed the same per-call
integration. Events carry `callId` and no parent field, so nesting needs the
integration's own `executeTool` wrapper (`ai` composes it around the tool's
`execute`) holding an `AsyncLocalStorage` value that the child's `onStart` reads:

```text
with wrapper:    [{"callId":"call-Mj3wq5s","parent":null},
                  {"callId":"call-wnjNtAI","parent":{"callId":"call-Mj3wq5s","toolCallId":"tp1"}}]
without wrapper: [{"callId":"call-nKvAGgN","parent":null},{"callId":"call-19t448Q","parent":null}]
```

result: `telemetry_per_call_replaces_global`: pass. A per-call integration replaces
the global ones for that call (0 events to the global one); with none given,
the global receives them.
result: `subagent_nests_under_parent`: pass with a wrapper. The child's call id
is linked to the parent's call id and tool-call id only when the integration
implements `executeTool` and a context store; without it the child run is a
separate root.

## Input-token upper bound per provider

Command: one request per text, `max_tokens` 1, text of 16,000 bytes (Bedrock)
or 2,500 bytes (Ollama, inside its default 4,096 context); compare the
reported input tokens with the byte length of the serialised request body.
`json_escapes` is quotes, backslashes, newlines and control characters, which
serialise to two to six bytes each.

| Provider        | Text             | Request bytes | Reported tokens | Reported / bytes |
| --------------- | ---------------- | ------------- | --------------- | ---------------- |
| Bedrock Haiku   | single-byte run  | 16,088        | 16,008          | 0.995            |
| Bedrock Haiku   | random ASCII     | 16,088        | 12,985          | 0.807            |
| Bedrock Haiku   | CJK (3 B/char)   | 16,090        | 10,982          | 0.683            |
| Bedrock Haiku   | base64           | 16,088        | 15,147          | 0.942            |
| Bedrock Haiku   | emoji (4 B/char) | 16,088        | 10,939          | 0.680            |
| Bedrock Haiku   | JSON escapes     | 44,796        | 10,637          | 0.237            |
| Ollama llama3.2 | single-byte run  | 2,592         | 338             | 0.130            |
| Ollama llama3.2 | random ASCII     | 2,592         | 1,603           | 0.618            |
| Ollama llama3.2 | CJK              | 2,594         | 1,618           | 0.624            |
| Ollama llama3.2 | base64           | 2,592         | 1,847           | 0.713            |
| Ollama llama3.2 | emoji            | 2,592         | 1,812           | 0.699            |
| Ollama llama3.2 | JSON escapes     | 6,988         | 1,786           | 0.256            |

The provider's own count: `bedrock:CountTokens` on the inference profile was
refused for this key ("not authorized to perform: bedrock:CountTokens"), so no
count API comparison was made. vLLM was not runnable on this host.

result: `input_upper_bound_per_provider`: pass for `bytes(serialised request)`
as a ceiling. Bedrock Anthropic reached 0.995 on a single-byte run (the
request overhead leaves 80 bytes of margin), so a smaller divisor than one
token per byte is unsafe there; Ollama llama3.2 peaked at 0.713. A fixed
`ceil(bytes)` ceiling holds on both; any tighter ratio must be per provider and
per model, and the Bedrock single-byte case rules out one under 1.0 for it.
`vllm`: `not_run`. `bedrock_count_tokens`: unavailable with this key (IAM).

# P5c identity spike: assistant identity

Question: how does a conversation of the console assistant get the agent identity the
spec gives it ("a conversation is one P5 agent instance ... each tool call gets a short
admin token from `mintAgentToken` ... No grant is made", spec 5.3)?
Method: read the code named below. Nothing was run; each claim carries the file and line
it was read at, and `assumption:` marks what only a test can settle. The assistant's
`assistantTokenMint` and `apps/server/tests/assistant-mint.int.test.ts` are read from
branch `p5c-i5`, which this branch does not yet contain.

## The failing path

A console sign-in is a grant of client `odudu-admin` with scope `openid`
(`packages/console-gateway/src/usecase/begin-login.ts:72`). `assistantTokenMint`
(`apps/server/src/assistant-chat.ts:67-117` on `p5c-i5`) passes that grant to
`mintAgentToken` with `scope: [MCP_READ_SCOPE]` (line 106) and `agentClientId` of the
grant's own client (lines 84, 104). Three things go wrong, in this order:

1. **`scope_widened`.** `standingRefusal` requires every requested scope to be in the
   grant's scope: `packages/protocol-oidc/src/service/agent-token-rules.ts:59-60`. The
   grant holds `openid`, the request is `mcp:read`. The mint throws `AgentTokenRefused`
   before any instance exists. (observed by reading; not run.)
2. **No instance even if (1) were waived.** `runIdFor` returns an instance id only when
   the client's OIDC config has `agentType` true
   (`packages/protocol-oidc/src/usecase/mint-agent-token.ts:164-166`). `odudu-admin` is
   not an agent type. The token would then carry `act.sub` = `"odudu-admin"` (lines 239
   and 264), a client id, so the conversation has no instance, no expiry, no budget slice
   and nothing for a revoke to end. (observed.)
3. **Attribution.** The tool runner builds its principal from the grant's client
   (`assistant-chat.ts:131-147` on `p5c-i5`), so every `agent.tool_call` row would name
   `odudu-admin`, the client a human's console actions use. (observed.)

`assistant-mint.int.test.ts` passes only because `mcpWorld` builds a grant of an MCP
client with `mcp:read` and `agentType` true. No test signs in as the console does.

What the admin API already guarantees, which every design below leans on: the token's
`sub` is the administrator, so the owner's own capabilities still gate each call
(ADR 0050, "The admin API enforces the narrowing"); `mcp:read` admits GET routes only; a
token that names an agent but holds no MCP scope is refused. So "never more than the
administrator holds" is held by the door. What the mint must hold is the scope ceiling:
in Ask mode nothing but `mcp:read` may ever be minted. `mcp:read` cannot come from the
console grant by narrowing (an exchange only narrows, ADR 0050), so some code must
introduce it deliberately.

## Candidates

**A. A built-in assistant client and a grant derived from the console session.**
Each tenant has a client `odudu-assistant` (agent type, no redirect URI, no grant type,
so it cannot be used at `/token`). When a conversation is created, a new usecase
`grantAssistantAccess` in `protocol-oidc` reads the console principal's grant and checks
that it is live, belongs to this tenant and subject, is a grant of `odudu-admin`, and
that its session is live. It then inserts a grant: client `odudu-assistant`, same
subject, same `sessionId`, `exchangedFromGrantId` the console grant, scope `mcp:read` for
Ask mode. `mintAgentToken` then runs unchanged with that grant id and client.

**B. A sibling `mintAssistantToken`.** It takes the console grant and shares
`instanceForRun` and `applyAgentLayer`, and replaces `standingRefusal`'s scope-held check
with a constant ceiling (`mcp:read`). The instance's `agentClientId` still has to be a
client row, so B also needs a seeded `odudu-assistant` client unless it reuses
`odudu-admin`. The root grant is the console grant itself.

**C. Widen `mintAgentToken`.** Accept a console grant by dropping the held-scope rule
for `odudu-admin` grants and treating that client as an agent type.

**D. Exchange in process through the RFC 8693 path.** The gateway holds the console
access token (ADR 0054); exchange it with `odudu-assistant` as the actor.

### Comparison

|                                        | A derived grant                                                                                                                                                                                                                                                                                                                      | B sibling mint                                                                                                                                                       | C widen the mint                                                                    | D token exchange                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Owner session end revokes the instance | Yes. The mint checks the session (`mint-agent-token.ts`, `instanceForRun` returns `owner_ended`); the derived grant carries the session; a revoke of the console grant cascades through `exchangedFromGrantId` (`docs/phases/p5.md`, item 5: revoking a grant revokes everything exchanged from it and every instance rooted there). | Yes through the session; the root is the console grant.                                                                                                              | As B.                                                                               | Yes, as A.                                                                                                                          |
| Lineage revocation cascades            | Yes: the root is the derived grant, itself under the console grant.                                                                                                                                                                                                                                                                  | Yes, but every conversation of a session is a root on one grant, so `liveRoots` (`agent-layer.ts`, `resolveParent`) counts conversations against `agentMaxChildren`. | As B.                                                                               | As A.                                                                                                                               |
| Budget slices                          | Per instance from tenant settings, as P5.                                                                                                                                                                                                                                                                                            | Same.                                                                                                                                                                | Same.                                                                               | Same.                                                                                                                               |
| Idle expiry                            | Unchanged (`instanceForRun` touches `idleExpiresAt`).                                                                                                                                                                                                                                                                                | Unchanged.                                                                                                                                                           | Unchanged.                                                                          | Unchanged.                                                                                                                          |
| No widening; Ask is read-only          | The ceiling is data: the grant's scope, checked by the unchanged `scope_widened` rule. A write mode is a separate grant, decided at conversation creation.                                                                                                                                                                           | The ceiling is a constant in a bypass branch of the most security-sensitive function.                                                                                | No ceiling beyond a flag on the client; any `odudu-admin` token holder can mint.    | Cannot add `mcp:read`: an exchange only narrows, and needs three operator switches that are off for every client (ADR 0050). Fails. |
| Changes in P5                          | One new door (the grant); `mintAgentToken` untouched. Amends spec 5.3 "No grant is made".                                                                                                                                                                                                                                            | A second mint entry; the first is untouched.                                                                                                                         | Changes the contract ADR 0050 states: an MCP token's grant is what bounds the mint. | Changes ADR 0050's exchange rules.                                                                                                  |
| Blast radius (files)                   | New `protocol-oidc/src/usecase/grant-assistant-access.ts` and a rule in `service/`, provisioning of the client, a backfill migration, `assistant-chat.ts` (grant before mint; the tool runner reads the client id from the grant), tests.                                                                                            | `protocol-oidc` mint and rules, provisioning if a client is seeded, `assistant-chat.ts`.                                                                             | `mint-agent-token.ts`, `agent-token-rules.ts` and every test of both.               | Gateway, token endpoint, exchange configuration.                                                                                    |
| Confused deputy                        | The grant is created from the verified console principal in the transaction that checks it, never from a body field; the new door is small and testable.                                                                                                                                                                             | The bypass is reachable by any caller of the function.                                                                                                               | Reachable from the MCP endpoint's caller too.                                       | Depends on three operator flags.                                                                                                    |
| Another tenant's token                 | Grant and client are read under the tenant context (RLS), and the usecase compares `grant.tenantId`, as `standingRefusal` does (`agent-token-rules.ts:55`).                                                                                                                                                                          | Same check.                                                                                                                                                          | Same check.                                                                         | Same.                                                                                                                               |
| Testability                            | Each rule a pure function plus an integration test on real PostgreSQL.                                                                                                                                                                                                                                                               | The bypass needs a negative test per refusal it skips.                                                                                                               | Weakens existing tests.                                                             | Needs the gateway in the test.                                                                                                      |
| Migration                              | Seed `odudu-assistant` for every tenant: at tenant provisioning and by a backfill for existing ones (`provision-admin-client.ts` is the pair to copy).                                                                                                                                                                               | The same, if a client is seeded.                                                                                                                                     | None.                                                                               | None.                                                                                                                               |

### Why not the rest

- **C** removes the property the mint exists to prove: that a person authorised an agent
  client to hold `mcp:*`. After C, any console token could self-mint an agent token. It
  also changes the door the MCP endpoint uses.
- **D** cannot work: the exchange narrows, and a console token has no MCP scope to keep.
  Making it work means widening the exchange, which is C by another path.
- **B** is smaller to write and holds the same property only by discipline. Its ceiling
  is a constant inside a bypass branch, its attribution still needs the client from A,
  and its conversations share one root grant, so the per-grant child limit throttles an
  administrator who opens many conversations. B is the fallback if the grant insert turns
  out to be unacceptable.

## Recommendation: A

`grantAssistantAccess` makes one grant per conversation, derived from the console grant.
The ceiling lives in a row the existing `scope_widened` rule already checks, so
`mintAgentToken` and every P5 invariant stay as proved. The lineage cascade comes from
`exchangedFromGrantId`, so signing out or revoking the console grant ends the
conversation with no new revoke code. Audit rows name `odudu-assistant`, so an
administrator can tell the assistant's calls from their own.

### Open points the implementer settles by a test, not by reading

- `assumption:` the minted token's capability check reads the owner's roles on the admin
  client whatever the token's `client_id`, so a token of `odudu-assistant` carries exactly
  the owner's capabilities. Prove with an administrator holding one capability and a tool
  call that needs another: 403.
- `assumption:` `liveCeiling` (`agent-layer.ts`) admits the assistant. It walks
  `exchangedFromGrantId` to `odudu-admin`; with no `delegatedActors` and no delegation
  configured, `actorAdmission` returns a null ceiling (`agent-mint.ts:123-133`). An
  operator who configures `delegatedActors` on `odudu-admin` makes the assistant refuse:
  it fails closed, which is right, but the error should say how to fix it. Prove with both
  configurations. (Run on 2026-11-26: the refusal is `run_refused`, not `actor_not_permitted`,
  because `mintAgentToken` folds every agent-layer refusal into `run_refused`.)
- `assumption:` console sign-out or a revoke of the console grant revokes the derived
  grants and the instances rooted on them (`docs/phases/p5.md` item 5 says so for
  exchanged grants). Prove with an integration test of console sign-out, not only of a
  grant revoke.
- One grant row per conversation is volume the 1,000,000-subject design has to count:
  administrators are few and a conversation is a human act. The phase spec states the
  bound and which reaper removes the rows with their session.

## Amendment text (drafts)

**Spec section 5.3, replacing "No grant is made."**

> The conversation's identity is derived from the administrator's console session. When a
> conversation is created, the server makes one grant for the client `odudu-assistant`:
> the same subject and session as the console grant, `exchangedFromGrantId` the console
> grant, and a scope that is `mcp:read` in Ask mode and nothing wider. The grant is made
> from the verified console principal, never from the request body. `mintAgentToken` is
> called with that grant, so the instance, its expiry, its budget slice and its revocation
> are P5's. Ending the console session or revoking the console grant ends every
> conversation under it. Changing a conversation to a mode that writes is a new grant
> with its own scope and its own approval, not a widening of this one.

**ADR 0060 draft: The assistant acts through a grant derived from the console session.**

> Status: Proposed.
> Context: the console grant holds `openid`; `mintAgentToken` needs a grant that holds
> `mcp:read` and belongs to an agent-type client (`agent-token-rules.ts:59`,
> `mint-agent-token.ts:164`).
> Decision: each tenant has a built-in client `odudu-assistant` that cannot be used at the
> token endpoint. A conversation holds a grant of that client, derived from the console
> grant and bound to its session, whose scope is the most the conversation may ever mint.
> The mint is not changed.
> Rejected: widening `mintAgentToken` for console grants (any console token could mint an
> agent token); a second mint with a bypassed scope check (the ceiling becomes code and
> all conversations share one root); an RFC 8693 exchange (it only narrows, and a console
> token holds no MCP scope).
> Consequences: spec 5.3 loses "No grant is made"; one grant row per conversation; audit
> rows name `odudu-assistant`; a backfill seeds the client in existing tenants.

## Tests that prove the invariants

All integration tests on real PostgreSQL, signing in through the console flow rather than
a fixture of an MCP client.

1. Console administrator, Ask mode: the mint succeeds; the token's `scope` is exactly
   `mcp:read`, `act.sub` is an instance id, `client_id` is `odudu-assistant`, `sub` is the
   administrator.
2. The same run key twice, and five at once: one instance.
3. **Scope widening (negative):** ask the mint for `mcp:write` on an Ask-mode grant:
   `scope_widened`; no instance written, no token.
4. **Scope widening at the grant door (negative):** `grantAssistantAccess` called with a
   scope beyond the mode's ceiling is refused; no grant row.
5. **Non-owner (negative):** administrator B asks for a conversation on administrator A's
   console grant: refused; no grant, no instance.
6. **Wrong grant (negative):** a grant of any client other than `odudu-admin` (an MCP
   client grant, a client-credentials grant) offered to `grantAssistantAccess` is refused.
7. **Other tenant (negative):** a console grant of tenant 1 used under tenant 2's context
   gives `grant_not_found`.
8. Capability ceiling: an administrator holding only one capability; a call that needs
   another returns 403 through the admin API and the audit row says so.
9. Ask mode is read-only at the door: a write route called with the minted token is 403.
10. Console sign-out: the instance and the derived grant are revoked, the token no longer
    verifies at the admin API, and a later mint refuses `owner_ended`.
11. Revoking the console grant through the admin API ends the instance by cascade.
12. Idle expiry: after `agentInstanceIdleSeconds` without use the instance is not live and
    the next mint refuses `run_refused`; a use before it slides the expiry, never past
    the session's end.
13. Budget slice: two conversations of one administrator each get a full slice and one's
    spend does not reduce the other's; a sub-agent's slice is carved from its parent's.
14. Lineage: revoking a conversation's instance revokes its sub-agent children.
15. `delegatedActors` configured on `odudu-admin`: the mint fails closed with
    `run_refused` (written `actor_not_permitted` before it was run), and succeeds once the
    assistant is named.
16. Provisioning: a new tenant has `odudu-assistant`; the backfill is idempotent; the
    client is refused at `/token` for every grant type.
17. Attribution: every `agent.tool_call` row of a conversation names `odudu-assistant` as
    actor client and the administrator as actor subject.
