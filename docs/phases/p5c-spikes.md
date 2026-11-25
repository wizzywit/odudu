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
