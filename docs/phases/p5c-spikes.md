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

## Bytes per token of the fixed part of a request

Run 2026-11-27 on macOS arm64, Node 24.15.0, `ai@7.0.181`, from a scratch script placed
in `packages/assistant` for the run and removed afterwards. The fixed part is what
`requestParts` serialises as `fixed`: the two system messages of `buildSystemPrompt` for
the free-chat profile (tenant text `Acme`) followed by the tool definitions of
`toolDefinitionsText(toSdkTools(assistantTools(TOOLS), …))`, so 62 tools. The request
was that system text, the tools and one user message `hi`, with `maxOutputTokens` 1.
The Bedrock key was read from the environment and never printed.

Commands (each printed sizes only):

- `node zz-measure.ts bedrock`: `generateText` through `@ai-sdk/amazon-bedrock`, model
  `eu.anthropic.claude-haiku-5-5`.
- `node zz-measure.ts ollama-compat`: `generateText` through `@ai-sdk/openai-compatible`
  with `includeUsage: true`, base URL `http://localhost:11434/v1`, model `llama3.2`.
- `node zz-measure.ts ollama-native`: `POST /api/generate` on the same Ollama with the
  `fixed` text as the raw prompt, `num_ctx` 65536, `num_predict` 1, reading
  `prompt_eval_count`.

| Provider                 | fixedBytes | inputTokens | bytes per token |
| ------------------------ | ---------- | ----------- | --------------- |
| Bedrock, Claude Haiku    | 54,715     | 22,983      | 2.381           |
| Ollama llama3.2 (native) | 54,715     | 14,441      | 3.789           |
| Ollama via `/v1`         | 54,715     | 2,050       | not valid       |

The Bedrock count includes the provider's own wrapping of the tools and the one-word
message, so it is the count a reservation has to cover. The `/v1` figure is the context
window of the model's default configuration (2,048 tokens, plus a few) and not the size
of the prompt, which Ollama cut silently; it is recorded because it shows that a
self-hosted server can report a count far below the request. The native run with a large
`num_ctx` is the llama3.2 measure.

result: the Bedrock ratio, 2.381 bytes per token, is below the 2.5 the estimate first
used, so 2.5 was not an upper bound there. The divisor is now 1.9, the Bedrock ratio less
20 percent, which reserves 28,798 tokens against the 22,983 Bedrock counted and 28,798
against the 14,441 llama3.2 counted. Two providers and one prompt are measured; a
provider whose tokenizer is harsher on JSON than Claude's is not.

# P5c act-mode design: how an approved write gets its token

Question: how does a write the assistant proposes in Act mode become an approval that
names the exact change, obtain a token that can make it without widening the
conversation's read-only grant, and who may decide it?
Method: read the code named below. Nothing was run; `assumption:` marks what a test must
settle first (each has one in the increment).

## What P5 already gives

- `requestApproval` writes an `agent_approvals` row (owner, requesting client, summary,
  `actionDigest`, ttl from the tenant's `agent_approval_ttl_seconds`, 20 pending per owner)
  and an audit row; `decideApproval` is the only writer of the decision, refuses anyone
  but the owner (`not_owner`) and lets one of two racing decisions through;
  `consumeApproval` is one conditional UPDATE valid only while `approved`, unexpired and
  for the same digest (`packages/protocol-oidc/src/usecase/approvals.ts:59,132,158`).
- `approvalDigest` hashes `{name, input, tenantId, ownerSubjectId, instanceId}` canonically
  (`packages/domain-agents/src/service/approval-digest.ts:46`).
- An agent token writes only through a route in `AGENT_WRITE_ROUTES`, only with `mcp:write`,
  only when minted by `mintAgentToken` (`via: mcp`) for POST, PUT and DELETE, and only
  inside the body fields the entry lists (`packages/protocol-admin/src/service/agent-scope.ts`,
  `router.ts:204-210`). Every other POST, such as a decision, is refused to any token that
  holds an MCP scope or names an actor, because a route outside the list admits nothing.
- The MCP endpoint reserves a write from the grant's budget before it forwards one
  (`callMcpTool`, `grantWriteBudget` in `apps/server/src/mcp-deps.ts:148`). A grant made
  by exchange takes its budget from the root grant (`budgetGrantId`,
  `repository/grants.ts:379-396`), so a new grant does not reset the allowance, and the
  owner's daily window is keyed by owner and agent client.

## (1) A write call becomes an approval that names the change

The twelve write tools are in the tool list in both modes; a policy decides per call
(`approvalPolicy`: reads `auto`, writes `deny` in Ask with a reason the model reads, `ask`
in Act). For `ask` the server, not the model, does three things before the stream says
anything:

1. It reads the target's current state with the conversation's own read token through the
   read tool that matches the write (a fixed table, one row per write tool, checked against
   the catalogue by a test), so the card's before is what the server read, never text the
   model wrote. A target that cannot be read is refused to the model, not shown blind. A
   create has no before; a message override or a theme that does not exist yet reads as
   "does not exist".
2. It derives the after from the validated tool input's body fields (`bodyFields` of the
   tool), the same fields the door admits, and a title from a constant per tool.
3. It stores one approval: `requestApproval` with `kind: assistant_write`, the assistant
   client as requester, `instanceId` null and `actionDigest` =
   `approvalDigest({ name: tool, input: { conversation, arguments }, tenantId,
ownerSubjectId, instanceId: null })`. The conversation is inside the digest so an
   approval cannot be spent in another conversation, and the tool name and every argument
   are in it, so approval for tool A cannot run tool B or a changed input. The card
   (title, target, before, after) is stored beside it in a new assistant-owned table
   `assistant_approvals`, keyed by approval id and by (conversation, tool call id).

The SDK's `toolApproval` returns `user-approval`, the stream ends with its
`tool-approval-request` and a `data-approval_card` part built from the stored card, with
the expiry read from the stored row. Nothing the model writes reaches the card.

## (2) The token: a grant of its own per approval, made when the approval is spent

The conversation's grant stays `mcp:read` (ADR 0060 says so: "until a write has a grant of
its own"). The narrowest mechanism that reuses P5 is a second grant of `odudu-assistant`,
made at the moment the approval is spent and living for that one call:

- **When.** In the resume request, inside the write tool's own `execute`, in one
  transaction: `consumeApproval(id, digest)` for the digest recomputed from the call about
  to run, then `grantAssistantWrite`, a sibling of `grantAssistantAccess`. If the consume
  fails nothing is made. If the grant is refused the transaction rolls back and the
  approval is still unspent, so the model is told it failed and the person is not asked
  twice for nothing.
- **What.** Subject and session of the console grant, `exchangedFromGrantId` the console
  grant (the request is the person's own, so the console grant is on the principal),
  scope `mcp:write` alone, id equal to the approval id. A primary key on that id means one
  approval makes at most one grant even if the consume were ever bypassed. It refuses the
  same things `grantAssistantAccess` does (not a live console sign-in of this tenant and
  subject, ended session, disabled subject or tenant, assistant client unavailable) and
  its own ceiling is `mcp:write` for one approval, never `mcp:read` plus.
- **Token.** `mintAgentToken` unchanged, with `subjectGrantId` the approval id, scope
  `[mcp:write]`, no `run`: the token's `act.sub` is the built-in client, not a new instance,
  so no new instance row, no live-instance limit and nothing to reap. It expires in the
  mint's own five minutes at most and its grant is revoked in `finally` the moment the call
  returns, so a copy of it dies with the call.
- **Call.** The same `callMcpTool` the MCP endpoint uses, now with `holdsWrite: true` and a
  real `grantWriteBudget` for the approval's grant, so the budget, the owner's daily window
  and the `agent.tool_call` row are P5's. The admin door still judges the owner's own
  capability and the route's agent rules.
- **Reused:** `requestApproval`, `decideApproval`, `consumeApproval`, `approvalDigest`,
  `mintAgentToken`, `AGENT_WRITE_ROUTES`, `callMcpTool`, `grantWriteBudget`, the grant
  lineage and revoke. **New:** `grantAssistantWrite` (one function and its rules), one table.
- **Not chosen.** A standing `mcp:write` grant per Act conversation: a write-capable
  credential would exist for the whole conversation and one bug in the policy would be a
  write with no person. A scope bypass in `mintAgentToken`: rejected for the reason ADR 0060
  gives. A per-approval instance (`run` key = approval id): the same, plus a row per write
  and the owner's live-instance limit for something one call long.

assumption: `mintAgentToken` without `run` for an agent-type client returns a token the door
admits for a PATCH; the mint's code path says it does (`runIdFor` returns null,
`mint-agent-token.ts:164-170`). Test first: a PATCH with it succeeds, and the same token
for a POST is refused unless `via: mcp` (it is set).

## (3) Who may decide

Only the signed-in administrator's own console session, through the console gateway. The
route is `POST …/assistant/conversations/:id/approvals/:approvalId` with `{ approve }`:

- A person's console token carries no `act` and no MCP scope, so the door treats it as an
  ordinary admin caller. A token the assistant minted (`mcp:read` or `mcp:write`, named
  actor) is an agent and the route is not in `AGENT_WRITE_ROUTES`, so it is refused with
  the door's `insufficient_scope` before the handler runs. That is the model's own token
  and any outside agent's. The same holds for the resume and mode routes.
- The handler calls `decideApproval` with `subjectId` from the verified token, `via:
'console'`. The owner check is P5's: another administrator, even one holding every
  capability, gets `not_owner`, and the route answers 404 so no approval id is confirmed.
  P5 allows no one else to decide; this increment adds no such path.
- CSRF is the gateway's: every write the browser makes passes its origin guard
  (`console-gateway/src/view/csrf-guard.ts`), and the admin API itself accepts only a bearer,
  so there is no ambient credential for a cross-site request to use.
- The conversation must be the caller's and the approval must be the conversation's, by
  the card table, so an approval id of another conversation of the same person is refused
  too. Every decision writes `assistant.approval` in the decision's own transaction (who,
  conversation, approval, tool, state, via; never the input or any text).
- A new message or a stop on a conversation with a pending approval withdraws it as a
  denial by the same owner, through `decideApproval`, so no second writer of `state` exists
  and `tests/lint/approval-decision-single-writer.test.ts` holds.

## Does it change ADR 0060 or a P5 invariant?

No P5 invariant changes: `mintAgentToken`, the approval object and its single writer, the
door's allowlist and the write budget are used as they stand. ADR 0060 gains an amendment
that says what its "until a write has a grant of its own" now is (one grant per approval,
`mcp:write`, spent and revoked with the call); its decision that the conversation's own
grant is `mcp:read` is untouched. Decision recorded for the controller to overrule: the
design stands unless the controller rules otherwise.

## Review rulings on the design

- The model's own token calling the decision route gets `403 insufficient_scope` from the door, not `401`: accepted, because a token the door authenticated and then refused for its scope is a 403 everywhere in the admin API.
- A card never shows a prefix: a value longer than `CARD_FIELD_MAX` is refused, not cut, and the assistant tells the person they can make the edit in the console.
- Pending assistant approvals are capped at 5 a conversation and 10 a person, counted under the owner's approval lock, in addition to P5's 20 shared with CIBA.
- A pending request carries the SDK's signature, keyed by an HKDF of the KEK with a fixed label; it is a second line behind the digest and the consume.
- Rotating `ODUDU_KEK` makes outstanding approval signatures fail verification; they expire within 15 minutes and a stuck conversation clears on the next message.
- A write grant a dead process left is revoked by the budget upkeep once it is ten minutes old.

## I10: audit rows for every turn

- `assistant.turn` is an `admin_mutation` action, as `assistant.budget`, `assistant.approval` and
  `assistant.config` are, so a tenant's `audit_event_types` cannot drop it. It is two rows a
  turn, `phase: started` and `phase: ended`, not one: a single closing row cannot make a turn
  fail closed at its start, and cannot exist at all for a process that died. The cost is two
  rows for each turn, bounded by the turn lease, the budget and the tenant's step cap.
- The `started` row is written in its own short transaction before the user's message is stored,
  before any lease-held work, before the first reservation and before any model call. The
  `ended` row is written after the budget settles and the lease is released, also in its own
  transaction (the audit repository's transaction is the server's, not the assistant's, so the
  port is `recordTurn(summary)`, not `recordTurn(tx, summary)`). A budget settle is a separate
  transaction for each step, so there is no single one to join.
- A turn refused by the lease limit, a resume with nothing waiting and a conversation not found
  start nothing, so they leave no `assistant.turn` row; a budget refusal after the turn began
  leaves both rows and an `assistant.budget` row.
- A `started` row with no `ended` row after the turn deadline (five minutes by default)
  means the server died, the stream was never drained, or the closing row failed
  (`assistant.turn_audit_failed` is logged for the last). No monitor query is shipped.
- Each assistant tool call keeps the post-call `agent.tool_call` row (so its outcome says
  whether the admin API refused it), now with `conversation` and `turn`. When that row cannot
  be written the call has run (a read, which changes nothing) and its data is withheld: the
  model never sees it. A per-turn latch in the tool runner then refuses the turn's later calls
  before they run, so at most one read goes unrecorded. For an approved write the change
  stands: its `assistant.approval` row and the mutation's own rows exist, and the model is
  told `audit_unavailable`. "Withheld" is not "did not happen". The brief asked that the call not run at all; recording before sending
  was tried and dropped, because the row would then say `allowed` for a call the door refused,
  which `assistant-identity.int.test.ts` pins as `refused`. `callMcpTool` is shared with the
  SDKs and unchanged.

## P5c spike: the assistant for a system administrator in another tenant

**Status: decided on 2026-11-26. The owner chose design A, with the audit split, "stricter wins"
and the operator's tenant paying as recommended below. Increment 1 (Ask, read-only,
cross-tenant) is built; Act, the console, and the trace and activity pieces follow in that
order.**

Read on 2026-11-26 from `origin/p5c-console-assistant` (HEAD `71309bc45`). Every claim carries
the file and line it was read at, or `assumption:`. Nothing was run: this is a reading spike.
Branch `p5c-i11` is not on origin, so the trace tables are read from the spec's text (5.9), not
from migration 0153 (`assumption:` they are `assistant_turns`, `assistant_steps` and
`assistant_events`, tenant-scoped, as 5.9 says).

### The question

The owner expects a system administrator in `/console/<other-tenant>/...`, holding
`manage-tenants` and the tenant's capabilities, to get the assistant, because it should do what
the console does. Today the chat routes answer that caller with the never-served 404
(`packages/protocol-admin/src/view/routes/assistant.ts:214-229`, `callerOf`). The brief expected
the console to hide the button. As read, it does not (see "The console gate"); that is a finding.

### (1) The failing paths and every place that assumes owner tenant = target tenant

The path of one Ask-mode conversation for a system administrator `S` (a subject of the `system`
tenant) in tenant `X`, in order. After each refusal the next row assumes it away to find the
following one. "Home" is the tenant `S` belongs to (`principal.issuerTenantId`); "target" is `X`,
the tenant in the path.

| #   | Where                                                                                                                                                                                                                                                                      | What breaks                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Door: `authenticate-admin.ts:141-177` accepts a system-issued token at any path; `:390` sets `issuerTenantId: matched.id` (system); `authorize-admin.ts:52-62` needs `manage-tenants` and the route capability, both read in the home tenant                               | Passes for `S`. It is the door the console's own cross-tenant calls use. Not a failure: the base the designs lean on.                                                                                                                                  |
| 2   | `assistant.ts:227` `if (principal.issuerTenantId !== tenantId) return null` in `callerOf`; `createConversationHandler` turns null into 404                                                                                                                                 | The refusal today. Clean, nothing written.                                                                                                                                                                                                             |
| 3   | `apps/server/src/assistant-chat.ts:315-317` (`accessGranter`): `lookup.byName(caller.tenantName)`, then `withTenantRetrying(db, tenant.id, ...)`; `grant-assistant-access.ts:105` reads the console grant under that tenant's context                                      | The console grant is a row of the home tenant. Under `X`'s context RLS hides it: `byId` returns null and `assistantGrantRefusal` says `grant_not_found` (`assistant-grant-rules.ts:70`, `grant?.tenantId !== grounds.tenantId`).                       |
| 4   | Foreign keys if the grant were made in `X`: `token_grants_subject_fk` (`0010_token_grants.sql:13`), `assistant_conversations_owner_fk` (`0147:19-20`), `agent_instances_owner_fk` and `_subject_fk` (`0141:27-30`)                                                         | `S` has no `subjects` row in `X`. The conversation insert is the 500 the brief names. The same composite key is on `agent_approvals_subject_fk` and `agent_budget_windows_owner_fk` (`0141_agent_identity.sql`, read above).                           |
| 5   | `mint-agent-token.ts:215-236` and `agent-token-rules.ts:56`: `grant.tenantId` must equal `deps.tenantId`, and the token is issued by `deps.issuer`                                                                                                                         | A token minted for `X` carries `X`'s issuer and `sub = S`. The door then treats it as `X`'s own administrator and resolves `S`'s roles in `X` (`authorize-admin.ts:55`), where there are none. Issuing it from the home tenant instead leads to row 6. |
| 6   | **`router.ts:205-212`: an agent token whose `issuerTenantId` is not the path tenant is refused `insufficient_scope`, for every route.** P5a's whole-branch review added it (`docs/phases/p5a.md:2079`; test `packages/protocol-admin/tests/agent-door-tenant.int.test.ts`) | The assistant's tool token is an agent token (`act` claim, minted by `mintAgentToken`). A system-issued one at `X`'s path is refused here whatever else is fixed. The brief did not name this one, and it has the largest blast radius of any design.  |
| 7   | P5a spec section 10, decision 3 (`docs/archive/specs/2026-11-06-p5a-mcp-parity-design.md:456-457`): "No `tenant` argument for a system administrator's agent ... Recommend: none in this phase; revisit in P5b with confirmation"                                          | A recorded decision, accepted by the owner on 2026-11-06. The owner's expectation now reverses it for the assistant, with an approval step. The amendment below says so.                                                                               |

Every other place that assumes owner tenant = target tenant, each read in the code:

- **Chat caller.** `ChatCaller.tenantId`, `tenantName` and `issuer` are one tenant
  (`packages/assistant/src/usecase/chat-deps.ts`, the `ChatCaller` interface). `caller.tenantId`
  is the tenant of every assistant transaction, 21 sites in `packages/assistant/src`
  (`git grep caller.tenantId`): conversations (`conversations.ts:53`), messages and the turn
  (`send-message.ts:67-71, 96, 150, 289, 310, 410, 458, 513`), approvals (`approvals.ts:27, 78,
112, 152`).
- **Conversation owner.** `conversationRepository.create` writes one `tenantId`
  (`repository/conversations.ts:34-46`); the read check is `record.ownerSubjectId !==
caller.ownerSubjectId` (`conversations.ts:55`, `send-message.ts:68`). Subject ids are UUIDs, so
  the owner check does not depend on the tenant; RLS does (`0147:50-60`, policy `tenant_id =
app.tenant_id`).
- **Grant derivation.** `assistantGrantRefusal` requires `grant.tenantId === tenantId`
  (`assistant-grant-rules.ts:70`); the `odudu-assistant` client is looked up by
  `byClientId(ASSISTANT_CLIENT_ID)` under the tx tenant (`grant-assistant-access.ts:107`), one per
  tenant (`clients_one_builtin_assistant`, `0150`). The system tenant has one: `0150` inserts it
  for every row of `tenants`, and `seed.ts:492, 780, 1196` provision it for new tenants
  (`assumption:` the system tenant's bootstrap goes through one of those; a test proves it).
- **Mint audience and issuer.** `mintAgentToken` takes the tenant from `deps.tenantId` and
  `deps.issuer` (`mint-agent-token.ts:215-270`); the assistant wires both from the caller
  (`assistant-chat.ts:128-141`). The token's audience is the fixed `ADMIN_API_AUDIENCE`.
- **In-process call.** The tool path is `expandPattern(pattern, token.tenant.name, params)`
  (`packages/mcp/src/adapter/in-process-caller.ts:49`) and the `host` header falls back to
  `token.issuer` (`:65`). `validatedMcpToken` takes `tenant` and `issuer` as separate fields
  (`packages/mcp/src/service/validated-token.ts:24-33`), so a target tenant with a home issuer
  fits without a change to `@odudu/mcp` (`assumption:` nothing else in `callMcpTool` reads
  `token.tenant`; `git grep 'token\.tenant' -- packages/mcp/src` found only that line and
  `admit-mcp-request.ts:130`, which the assistant does not use).
- **Approvals.** `open` takes the per-owner advisory lock `agent-approvals:<owner>` and counts
  pending rows `where a.tenant_id = <tenant> and a.subject_id = <owner>`
  (`assistant-approvals.ts:92-102`); `answer` demands that the console grant is a live sign-in of
  the built-in admin client in the tenant it runs in and that `grant.subjectId` is the owner
  (`:147-157`); the digest binds `tenantId`, owner, conversation, tool and arguments (`:34-51`). A
  card is `assistant_approvals`, with composite FKs to the approval and to the conversation, so
  approval, card and conversation must share one tenant (`0152:22-25`).
- **Write grant.** `grantAssistantWrite` derives from the console grant in the tx tenant
  (`grant-assistant-access.ts:77-91`), its id the approval's id.
- **Budgets.** Four levels, all rows of one tenant (`0148:6-13`, policy `0148:60-62`); keys are
  `tenant_month: tenantId`, `admin_day: ownerSubjectId`, `conversation`, `turn`
  (`service/limits.ts:74-96`). One reservation charges all four in one transaction
  (`budget-hooks.ts`), so all four must be rows of one tenant context. The turn lease counts per
  tenant (`repository/leases.ts:36-43`). The limits come from the tenant's own settings
  (`usecase/entitlements.ts:6-9`, read through the tx given).
- **Settings.** `assistant_enabled`, `assistant_mask_emails`, `assistant_default_mode`,
  `assistant_trace_retention_days` and `assistant_auditor_visible` are columns of the tenant row
  (`repository/settings.ts:8-26`; contract `contracts/src/admin/assistant.ts:21-56`). The turn
  reads `settings.assistant_mask_emails` through the home tx (`send-message.ts:71, 77`) and
  narrows the mode by the limits of that same tx (`:79-83`); the status and the create gate read
  the path tenant (`assistant.ts:58-67` status handler, `assistant.ts:199-207`
  `tenantOffersAssistant`, both `adminTx(..., tenantId)` of the path). So today's code already
  reads the **target's** `assistant_enabled` and would read the **home's** `mask_emails` and
  limits: the split is half there, by accident.
- **Audit.** `audit_events.tenant_id` is "the tenant the event happened to": a system
  administrator acting on another tenant writes a row that tenant's own administrators can read
  (`0067_admin_audit.sql:1-3`), with `actor_tenant_id` separate (`:16`). The tool-call row is
  written with `withTenant(db, caller.tenantId)` and `actorTenantId: principal.issuerTenantId`
  (`assistant-call.ts:92-95`, `access-audit.ts:84-88`). The `assistant.turn`, `.budget` and
  `.approval` rows are written in `caller.tenantId` (`assistant-chat.ts:241-306`,
  `assistant-approvals.ts:174-192`).
- **Trace and activity.** Spec 5.9: the trace tables are tenant-scoped and the activity screen is
  gated by `read-assistant-activity` of the tenant it is opened in; retention is a per-tenant
  setting; a reported conversation survives retention (`reported_at`, `0147:16-17`).
- **Gateway.** The console cookie is bound to the tenant the person signed in to
  (`resolve-session.ts:35-41, 57-70`); the gateway forwards `/admin/tenants/<X>/...` with the
  **home** session's token and the path unchanged (`forward.ts:51-68`: `prepareCall` never reads
  the path tenant; `:124-139` `refusedAtHome` asks the home tenant's whoami). The stream route
  does the same (`forward-stream.ts`). So a system administrator's console grant, session and
  refresh token are home rows, and nothing in the gateway needs to change.
- **whoami and the gate.** whoami answers the **home** tenant's `capabilities`, `crossTenant`, and
  a deployment-wide `assistant_available` (`whoami.ts:29-40`). The console gate is
  `assistantAvailable === true && holds(use-assistant)` (`gate.ts:10-12`;
  `useAssistantAvailable.ts:6-7`); it asks `GET .../assistant/status` of the path tenant.

#### The console gate

`apps/admin-console/src/widgets/shell/use-cases/useAssistantAvailable.ts:6-7` calls
`mayUseAssistant(useAuthority(tenant))` and nothing else. `signedInTo` does not occur in the
assistant code: it is the parameter of the banner for a person signed in to a **different**
tenant (`shellText.ts:12`, `sessionStatusText.ts:44`). So, as read, a system administrator who
holds `use-assistant` in the system tenant sees the button in `/console/X` when `X` has the
assistant enabled, opens the panel, and the first create answers 404. (`assumption:` a console
test confirms it; `gate.test.ts` and `AssistantGate.test.tsx` have no cross-tenant case, read by
file name only.) That is a visible defect today whichever design is chosen, and the cheapest
correct stopgap is one condition in the gate: hide when `authority.crossTenant`.

### (2) Candidate designs

Facts every design meets (read above): the console session and the grant a conversation derives
from belong to the home tenant; the door already accepts the home-issued token at the target's
path and checks `manage-tenants` plus the route capability in the home tenant on every call
(`authorize-admin.ts:52-62`). `assumption:` `effectiveRoles` is not cached across requests, so a
role removed mid-conversation refuses the next call; a test proves it.

#### A. Everything the assistant owns lives in the operator's tenant, the target is a column, the door gets one narrow exception

- Conversation, messages, trace, budget counters, leases, approvals, cards, the derived grant, the
  agent instance and every `assistant.*` audit row: tenant = home. `assistant_conversations`
  gains `target_tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE`, null meaning "the home
  tenant itself" (today's case, unchanged).
- The derived grant is made in the home tenant by `grantAssistantAccess`, which also writes the
  grant's target: `token_grants` gains nullable `target_tenant_id` (`REFERENCES tenants (id) ON
DELETE CASCADE`). Only that function writes it, and it refuses unless the home tenant is the
  system tenant (`isSystemTenantId`, `packages/domain-tenant/src/service/admin-capabilities.ts:64`).
- `mintAgentToken` is called exactly as today, in the home tenant, with the home issuer. Its token
  has `sub = S`, the home issuer and `act.sub` = the instance.
- The door exception (`router.ts:205-212`): an agent principal whose issuer is not the path tenant
  is admitted only when **all** of these hold. The agent client is `builtin_assistant`
  (`ClientState.builtinAssistant` is already loaded by `authenticateAdmin`,
  `authenticate-admin.ts:69`, and `checkGrantLiveness` returns it, `:302-343`; today
  `AdminAgent` has no such flag, `:29-39`, so it is added). The token carries the endpoint marker
  (`via: mcp`, as `agentWriteNeedsEndpoint` already requires). The issuer is the system tenant.
  **The grant's `target_tenant_id` equals the path tenant's id.** The binding is a database row,
  not a claim in the token, so `mintAgentToken` stays unchanged and a leaked five-minute token
  reaches one tenant. Then `authorizeAdmin` runs as it does for the console: `manage-tenants` plus
  the route capability, both live.
- The tool call is made with `validatedMcpToken({ tenant: target, issuer: home issuer, ... })`, so
  the path is the target's and the bearer is the home's. The `agent.tool_call` row is written in
  the **target's** trail (`withTenant(db, target.id)`) with `actor_tenant_id` = home and the
  conversation and turn ids, which is the existing meaning of `audit_events.tenant_id`
  (`0067:1-3`). The admin API's own mutation rows land in the target's trail as they do for the
  console.
- `ChatCaller.tenantId/tenantName/issuer` stay the **home** tenant, so the 21 `caller.tenantId`
  sites and the approval and grant ports are untouched; it gains `target: { id, name }`, equal to
  the home tenant when same-tenant. Only five things read the target: the tool call, the tool
  set's visibility, the settings read, the digest and card, and the path-versus-conversation
  check.
- Keeps (ADR 0060 and P5): the owner's session end revokes the grant and instances (same tenant as
  the console grant, `exchangedFromGrantId`, unchanged); no scope widening (the ceiling check is
  untouched, and the target binding only narrows the assistant below the console token, which
  reaches every tenant); never more than the signed-in administrator (the door's live
  `manage-tenants` and capability checks); budget slices unchanged; the approval decision is the
  owner's own console sign-in in the home tenant (`assistant-approvals.ts:147-157` unchanged).
- Changes: a migration (two nullable columns, two partial indexes, the trace tables later); the
  door; `grantAssistantAccess` and `grantAssistantWrite` take a target; `callerOf`; the in-process
  call's tenant; the settings rule; the digest and card carry the target; the console gate and
  panel.
- Blast radius (files): `packages/protocol-admin/src/view/routes/router.ts`,
  `src/usecase/authenticate-admin.ts` (the `assistant` flag on `AdminAgent`),
  `src/view/routes/assistant.ts`; `packages/protocol-oidc` `grant-assistant-access.ts`,
  `assistant-grant-rules.ts`, the grant repository and record; `packages/assistant`
  `chat-deps.ts` (`ChatCaller.target`), `conversations.ts`, `send-message.ts` (`readHead`),
  `tool-set.ts`; `apps/server/src/assistant-call.ts`, `assistant-chat.ts`,
  `assistant-approvals.ts`; one migration under `packages/db/drizzle`; `packages/contracts` (the
  card and the conversation view); the console `entities/assistant`, `widgets/assistant-panel` and
  the shell gate; docs and transcripts. `@odudu/mcp`, the console gateway, `mintAgentToken` and
  the P5 approval and budget tables: no change.
- Risks: (a) the door exception is the first place an agent token crosses a tenant, so it is
  security-critical; it is narrowed by four conditions and one row binding, and the P5a test
  `agent-door-tenant.int.test.ts` stays as it is for every other agent (the `mcp` job passes with
  no changed expectation). (b) Cross-tenant data lands in the home tenant's tables (messages,
  trace): see "Who sees the conversation". (c) A tenant's own settings must not be overridden: the
  settings rule below. (d) A conversation bound to `X` presented at `Y`'s path: refused by the
  path-versus-conversation check and, for the tool call, by the grant binding at the door, two
  independent refusals. (e) A bug that writes a target onto a non-assistant grant is harmless:
  the door honors it only for the built-in assistant client, with the endpoint marker, from the
  system tenant.
- Data model: `assistant_conversations.target_tenant_id` (null = home), `token_grants.
target_tenant_id` (null = no cross-tenant reach), partial indexes `WHERE target_tenant_id IS NOT
NULL` for the cascade deletes and the activity filter (ADR 0041: a tenant delete must not scan;
  10,000 tenants; `token_grants` is large and the column is almost always null, so the partial
  index is tiny).
- RLS: policies unchanged, `tenant_id = app.tenant_id`; every new row carries the **home**
  `tenant_id`. `target_tenant_id` is in no policy. A tenant `X` administrator's context sees none
  of the operator's conversations (the foreign-tenant probe is a test).
- Scale: one extra short read of the target's settings per turn start and per create, constant;
  no new per-request query at the door (the grant is already loaded by `checkGrantLiveness`; the
  record gains one column). A system administrator's conversation is a human act of a few people,
  the bound ADR 0060 states.
- Testability: reachable with the existing fixtures: `startAdminFixture` (the door), the assistant
  identity integration tests, a two-tenant world.

#### B. The conversation lives in the target tenant, the owner is `(owner_tenant_id, owner_subject_id)`, the FKs are loosened

- Conversation, messages, trace and approvals in `X`; owner columns without the `subjects` FK; the
  grant and the instance either in `X` too or split.
- If the grant is in `X`: `token_grants_subject_fk`, `agent_instances_owner_fk` and `_subject_fk`,
  `agent_approvals_subject_fk` and `agent_budget_windows_owner_fk` all lose their tenant-composite
  key (five constraints on tables that are P5's and, for `token_grants`, every OIDC flow's), and
  the token is issued by `X` for a subject `X` does not have. The door would have to resolve `S`'s
  roles in `S`'s tenant for a foreign subject. That breaks the property `authenticateAdmin` is
  built on, that a token's issuer is the tenant of its subject (ADR 0037's foreign-issuer refusal
  rests on the same property). Rejected.
- If the grant stays in the home tenant and only the conversation is in `X` (B'): the grant, the
  instance and the approval are home rows and the conversation, messages and card are `X` rows, so
  "the grant is made in the transaction that creates the conversation" (ADR 0060) cannot hold: one
  transaction has one `app.tenant_id` and RLS is `FORCE`d. The card's FKs to the approval and to
  the conversation (`0152:22-25`) cannot span two tenants. It needs two transactions with an
  orphan sweep between them. Rejected: it gives up the atomicity ADR 0060 is built on, to put rows
  where they are not needed.
- It does keep what A cannot: the conversation text sits in the tenant it is about, so that
  tenant's auditors see it on the existing screen and its retention and erasure apply with no
  join. A's answer to the same need is the cheap read path in "Who sees the conversation".

#### C. A per-tenant operator stand-in subject

- Each target tenant gets a subject for each operator; the grant, instance and conversation are
  ordinary rows of `X`; the stand-in holds the operator's capabilities in `X`.
- `assumption:` it needs a role assignment in `X` for each operator, kept equal to the operator's
  `manage-tenants` plus capabilities. Any drift is privilege escalation or a stale grant; removing
  `manage-tenants` from `S` does not remove the stand-in's roles unless a sync does, so "never
  more than the signed-in administrator" is held by a job and not by the door. A phantom subject
  appears in `X`'s user list, counts, exports and erasure, and `X`'s administrators can edit or
  delete it. The audit actor is the stand-in, not `S`, unless columns are added. Rejected on the
  first invariant alone.

#### D. Other options considered

- **D1. Keep refusing, and make it honest.** Hide the button when `crossTenant`; document that a
  system administrator uses `odudu mcp` or signs in as a tenant administrator of `X`. No security
  change, an hour of work, and not what the owner expects. It is the stopgap while A is built
  (increment 0), not the answer.
- **D2. The administrator's own console token, no agent token.** No door exception is needed, but
  the call then carries the console token's full authority with no `mcp:read` ceiling, no
  per-call instance and no write budget, and the audit names `odudu-admin`. It undoes ADR 0060.
  Rejected.
- **D3. A tenant argument on the tools** (the other branch of P5a decision 3): one conversation
  could reach several tenants. It widens what the owner did not ask for and puts the tenant in the
  model's hands. Rejected: the target is fixed at creation, from the path, and the model never
  names a tenant.

### (3) Recommendation: A

A is the only candidate that keeps ADR 0060's single transaction (the grant and the conversation
are made together), keeps the home-tenant identity chain intact (session, console grant, derived
grant, instance, approval, owner lock, budget), so no P5 table or invariant changes, and needs no
phantom subject. Its one real cost is the door exception, which is the right place for that
decision to live because the door already decides every cross-tenant call for the console, live,
per request. The exception is narrower than the console's own reach: one tenant, fixed at
creation, bound by a row.

B and B' trade the ADR 0060 atomicity, or the "token issuer is the subject's tenant" property, for
the placement of rows. C trades the door's live check for a sync job. D1 is the stopgap, D2 undoes
0060, D3 widens the reach.

#### Settings: whose apply

One rule: **the stricter of the two tenants applies, and the target's wishes are never overridden
by the operator.** The conversation is the operator's (their provider spend, their tenant); the
data is the target's.

| Setting                               | Applies                                                                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant_enabled`                   | Both must be on. Target off: create and send answer 404 and the console shows nothing (the `offered` check already reads the path tenant, `assistant.ts:199-207`). Home off: the operator's own switch, checked at create.                          |
| `assistant_mask_emails`               | On if **either** is on. The target's data reaches the provider; the target's mask is the one that matters and the operator's is added to it.                                                                                                        |
| `assistant_default_mode`, Act allowed | Act only where **both** allow it: `readHead`'s mode narrowing (`send-message.ts:79-83`) must read the target's limits as well as the home's. Default mode: the target's.                                                                            |
| Token limits (`limitsFromSettings`)   | The home tenant's (the operator pays); all four levels are home rows (one reservation, one transaction). `tenant_month`'s key stays the home tenant id. `assumption:` a per-target cap would be a fifth level or a key change; not recommended now. |
| `assistant_trace_retention_days`      | The **shorter** of the two, evaluated by the reaper with a join to the target (rows are the home's, the data is the target's).                                                                                                                      |
| `assistant_auditor_visible`           | The home's, for who in the home tenant sees it; the target's auditors learn of it from the audit trail, not by being shown the text (below).                                                                                                        |

#### Audit: in which trail does a cross-tenant action appear

Split by where the thing happened, which is the existing rule (`0067:1-3`):

- **Target trail** (visible to `X`'s own `view-audit` holders): every `agent.tool_call` row (tool,
  route, outcome, `actor_tenant_id` = home, `actor_subject_id` = `S`, conversation and turn ids)
  and the admin API's own mutation rows for an approved write, as for the console. `X`'s
  administrators can therefore see that an operator used the assistant in their tenant, which
  tools and when, without the text.
- **Home trail:** `assistant.turn` (started and ended), `assistant.budget`, `assistant.approval`,
  `assistant.access_refused`, `assistant.config`. They carry `target_tenant` (id) in `detail`.
- **One row in both:** `assistant.approval`. A decision authorises a change in `X`; write it in
  both trails (the volume is one per approved write). The turn rows are not duplicated: they would
  give `X` a row per turn for what the tool-call rows already say. `assumption:` the owner
  confirms this split; the alternative is an `assistant.turn` marker in `X` (the `started` row).
- A refused cross-tenant create (no `manage-tenants`, no capability): the door already records
  `capability.refused` in the target (`router.ts:216-227`); the assistant's own
  `assistant.access_refused` goes to the home trail.

#### Who sees the conversation

The conversation, its messages and its trace are home rows, so they are visible to the owner and,
through the activity screen, to home-tenant holders of `read-assistant-activity` when
`assistant_auditor_visible` is on in the home tenant. The target's auditors do **not** see the
text: it is not their row (RLS), and a system administrator reading `X`'s data through the console
leaves a trail of actions, not of what was read, as it does today. Stated as residual risk in the
spec: an operator's conversation contains `X`'s data and sits under the operator's retention
(capped by `X`'s, below). `X` is told by its own audit trail. A later increment may add a
redacted "operator sessions" list to `X`'s activity screen (turn, time, tool counts) from the
target-trail rows; it needs no new table.

#### The trace tables (spec 5.9)

`assistant_turns`, `_steps` and `_events` are home rows; each gains `target_tenant_id` (null =
home), so the activity screen can filter by target and the reaper can join the target's retention.
A tool result that carries `X`'s data is stored in the home trace as it is stored in `X`'s trace
today (masked for secrets, ADR 0058). `assumption:` the recorder takes `tenantId` from the same
`ChatCaller`; confirm when `p5c-i11` lands.

#### Retention, erasure, export

Retention: the reaper's predicate becomes `least(home_days, coalesce(target_days, home_days))`
with a join to `tenants` on `target_tenant_id` (bounded: the reaper walks `(tenant_id,
created_at)` as today and joins only rows with a target). `reported_at` still exempts. Erasure of
the target tenant cascades: `ON DELETE CASCADE` on both new columns removes the conversations
about it, their messages (the existing conversation FK) and the grants. Erasure of the operator
removes theirs (`owner_fk`, unchanged). A tenant export of `X` does not include the operator's
conversations about it (they are not `X` rows); say so in the export documentation.

#### The console gate

The button shows for a system administrator in `/console/<X>` exactly when: whoami says the
deployment has an assistant; whoami's `capabilities` hold `use-assistant`; and, when `crossTenant`
is true, they also hold `manage-tenants` (the vocabulary includes it, `whoami.ts:17-20`; the door
checks it anyway, so this only avoids a button a 403 would answer). Then `GET
/admin/tenants/<X>/assistant/status` decides, which reads the **target's** settings
(`assistant.ts:58-67`): `enabled: false` there draws nothing. The operator's own
`assistant_enabled` is checked by the server when the conversation is created (the gate cannot read
it without a second request to the home tenant, and the answer for an operator who turned it off
is the existing 404-as-disabled). The panel's header names the tenant ("Acting in acme as a system
administrator"), next to the context bar that `actsWithSystemAuthority` already shows
(`systemAuthority.ts:20-27`). The panel starts a new conversation when the route's tenant changes
(`assumption:` `AssistantGate` is not remounted per tenant today; a conversation bound to `X`
answers 404 at `Y`'s path by the check in test 5, so the worst case is an error, never a
wrong-tenant action), and the approval card shows the tenant. Until A ships, hide the button when
`crossTenant` (increment 0).

#### Amendment text (drafts)

**ADR 0060, a new amendment ("A system administrator in another tenant").**

> A system administrator acting in another tenant has the assistant for that tenant. The
> conversation, its grant, its instance, its approvals, its budget and its trace are rows of the
> administrator's own tenant (the system tenant), because the console grant they derive from, the
> subject that owns them and the tenant-composite keys of every table involved are there.
> `assistant_conversations.target_tenant_id` and `token_grants.target_tenant_id` name the tenant
> the conversation acts in; both are null for a conversation in the administrator's own tenant,
> which is unchanged. `grantAssistantAccess` writes the target and refuses unless the console
> grant's tenant is the system tenant. `mintAgentToken` is not changed: the token is issued by the
> system tenant, for the administrator, with the instance as `act.sub`, as today.
>
> The admin API's rule that an agent acts only in the tenant its token names (P5a) gains one
> exception, and only one: a token whose agent is the built-in assistant client of the system
> tenant, carrying the endpoint marker, is admitted at a path whose tenant is the
> `target_tenant_id` of the grant it stands on, and at no other. The administrator's
> `manage-tenants` and the route's capability are then checked live on every call, as for the
> console. A grant with no target, any other agent client and any other tenant keep the rule as it
> was.
>
> The target is fixed when the conversation is created, from the verified path, and never from the
> request body or the model. A tool names no tenant. An approval's digest binds the target and its
> card names it. The call's audit row is in the target's trail, with the administrator as actor
> and the system tenant as actor tenant; the assistant's own rows are in the administrator's. The
> target's `assistant_enabled`, `assistant_mask_emails` and Act setting are never overridden by
> the operator: the stricter of the two applies.

Rejected, to add to the ADR's list: **a conversation in the target tenant with a foreign owner**
(it gives up the single transaction and the rule that a token's issuer is its subject's tenant);
**a stand-in subject per tenant** (its authority is kept equal to the operator's by a sync, not by
the door); **the console token as the agent's** (no ceiling, no instance, audit names
`odudu-admin`).

**Spec 5.3, appended to the paragraph on the conversation's identity.**

> When the administrator is a system administrator acting in another tenant, the conversation, its
> grant, instance, approvals, budget and trace belong to their own tenant, and the conversation
> names the tenant it acts in. The tool calls are made in that tenant with the administrator's own
> authority: the admin API checks `manage-tenants` and the route's capability on every call, and
> admits the assistant's token at that one tenant's routes only (ADR 0060's amendment). The
> assistant names no tenant in a tool call.

**Spec 5.2, appended to the paragraph on the tenant's switch.** "Where a system administrator
uses the assistant in another tenant, that tenant's switch, email masking and Act setting apply as
well as their own tenant's, and the stricter wins; the administrator's tenant pays the token
spend."

**Spec 5.9, appended to Audit.** "A tool call made in another tenant leaves its `agent.tool_call`
row in that tenant's trail, naming the administrator and the conversation; the turn, budget and
approval rows stay in the administrator's tenant, and an approval is recorded in both."

**Spec section 2, Anti-goals, one clause:** "An assistant that reaches a tenant its conversation
was not created for."

**Spec section 9 (residual risk).** "A system administrator's conversation holds the target
tenant's data under the operator's retention, capped by the target's; the target's administrators
see the actions in their own audit trail and not the text."

**P5a spec section 10, decision 3** is archived and not edited; the pointer goes in the P5c phase
note and `docs/NEXT.md`: "revisited for the console assistant only, ADR 0060 amendment; the MCP
endpoint and external agents keep the same-tenant rule."

### Tests that would prove the invariants

Integration (real PostgreSQL, the existing fixtures), each negative one first:

1. **A tenant administrator cannot reach another tenant.** A tenant `X` administrator with
   `use-assistant` posts `POST /admin/tenants/Y/assistant/conversations`: 403 at the door
   (`authorize-admin.ts:57-59`), no row, no grant, no `assistant.*` row in either tenant.
2. **A system administrator without `manage-tenants`:** 403 at the door, `capability.refused` in
   the target's trail.
3. **A system administrator with `manage-tenants` but without the target capability**
   (`use-assistant`): 403, nothing created. With `use-assistant` but without a tool's own
   capability (for example `manage-clients`): the tool call is refused 403 by the door,
   `agent.tool_call` outcome `refused`, in the target's trail.
4. **A role removed mid-conversation.** Remove `manage-tenants` from `S` after the create: the
   next tool call is refused; add it back: the same conversation works again (the grant and the
   instance did not depend on it).
5. **The binding, three ways.** (a) A conversation created at `X` presented at `Y`'s path (load,
   send, stop, resume, approvals, mode): 404 each. (b) The conversation's own token used by hand
   at `Y`'s tool route (in-process caller given `Y`): refused `insufficient_scope` by the door
   because the grant's target is `X`. (c) The same token at `X`'s route: admitted.
6. **The exception is narrow.** `agent-door-tenant.int.test.ts` unchanged and green (read, PATCH,
   POST, PUT and DELETE for a direct, an exchanged and an endpoint token). New, each refused at a
   foreign path: a system-issued assistant token **without** the endpoint marker; one of an
   **external MCP** client (`builtin_mcp`); one whose grant has `target_tenant_id` null; one of a
   **tenant**-issued assistant grant. A non-system tenant cannot create a grant with a target:
   `grantAssistantAccess` refuses (unit and integration).
7. **A cross-tenant read returns only the target's data.** For two tenants with distinct
   subjects: `list_subjects`, `get_subject`, `list_clients` and `list_audit` in the conversation
   for `X` return `X`'s rows and never `Y`'s; `get_subject` given `Y`'s subject id answers 404; no
   tool schema has a property naming a tenant (a lint over `TOOLS`). Instance reads
   (`list_tenants`, `count_tenants`) are not offered in a conversation whose target is not the
   system tenant.
8. **An approval cannot be decided by another administrator.** `S2`, another system administrator
   holding every capability, decides `S`'s approval: `not_found` (`not_owner`); a tenant `X`
   administrator: 403 at the door; the assistant's own agent token deciding: refused
   (`assistant-approvals.ts:147-157`: the grant must be the built-in admin client's sign-in); `S`
   after signing out: the grant is revoked, 404. An approval minted for `X` replayed after the
   conversation is re-targeted fails `consumeApproval`, because the digest includes the target.
9. **Ending the owner's session** (console sign-out of `S`, and a revoke of the console grant)
   revokes the derived grant and the instance of a **cross-tenant** conversation and the next call
   is refused: ADR 0060's invariant, shown for a conversation with a target.
10. **Settings.** Target `assistant_enabled = false`: create 404, console shows nothing; home off:
    create refused; either `mask_emails`: masked; Act off in either: Act refused; retention the
    shorter. Target disabled mid-conversation: calls fail closed.
11. **Audit placement.** After a read and an approved write in `X`: the `agent.tool_call` rows and
    the mutation row are in `X`'s trail with `actor_tenant_id` = system; `assistant.turn` rows are
    only in the system trail; `assistant.approval` is in both; `X`'s administrator can list the
    first set and cannot list the second.
12. **RLS and foreign-tenant probes** for every table carrying `target_tenant_id` (conversations,
    token grants, the trace tables): a context of `X` reads none of the operator's rows; a context
    of the system tenant reads only its own. Deleting tenant `X` removes the conversations,
    messages, cards and grants that target it.
13. **Budget.** Spend in a cross-tenant conversation is counted in the home tenant's four levels
    and never in `X`'s counters (`select` under `X`'s context: no counter rows).
14. **Unchanged cases.** A system administrator in the **system** tenant and a tenant
    administrator in their own: behaviour identical to today (`target_tenant_id` null); the
    existing identity and approvals integration tests pass with no changed expectation.
15. **Console** (component and Playwright): the gate matrix (same-tenant, cross-tenant with and
    without `manage-tenants`, target off, assistant unavailable); the panel shows the tenant;
    switching `/console/X` to `/console/Y` ends the panel's conversation; the approval card shows
    the tenant.

### Increment plan

0. **Stopgap, 1 h.** Hide the button when `crossTenant` (`mayUseAssistant`), with the gate matrix
   test. Independent of A; removes today's dead button.
1. **A read-only cross-tenant conversation (Ask), 12 to 14 h.** Migration (two nullable columns,
   partial indexes, FKs with cascade); `grantAssistantAccess` with a target and its refusal;
   `ChatCaller.target`; `callerOf` and the path-versus-conversation check; the door exception and
   the `assistant` flag on `AdminAgent`; `callAsAssistant` with the target tenant and the
   target-trail audit write; the settings rule; the negative suite (tests 1 to 7, 9, 10, 12 to
   14). This is the increment that gets the security review.
2. **Act mode across tenants, 5 to 6 h.** `grantAssistantWrite` with the target; digest and card
   carry the target; `assistant.approval` in both trails; tests 8 and 11 for writes.
3. **Console, 5 to 6 h.** The gate (with `manage-tenants`), the tenant-named panel and card, the
   panel reset on tenant change, wording constants, console tests (15), the transcript of the
   cross-tenant create re-run on a live stack, docs (concept, console area page, the settings
   rule in the configuration reference), `CHANGELOG.md`, the `docs/NEXT.md` pointer.
4. **Trace, activity and retention, 3 to 4 h** (folds into the trace increment if `p5c-i11` is not
   yet merged): `target_tenant_id` on the trace tables, the activity filter, the reaper's
   `least()` with the join; the redacted list in `X`'s screen stays deferred.

About 26 to 31 hours in all. Increment 1 is the only one that needs the owner's confirmation first
(it relaxes a rule P5a recorded); the others follow from it.

### Open points for the owner

- Confirm the door exception: it reverses P5a decision 3 for the assistant only, not for
  `odudu mcp` or external agents.
- Confirm the audit split (assistant rows at home, tool-call rows in the target, approvals in
  both), and that the target's administrators see actions and not text.
- Confirm "stricter wins" for settings and that the operator's tenant pays.
- `assumption:` the system tenant has the `odudu-assistant` client and its console client is not
  configured with `delegated_actors` that omit it (`assistant-chat.ts:178-180` already states the
  failure); a test starts from the bootstrap command's system tenant.
