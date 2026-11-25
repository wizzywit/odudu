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
