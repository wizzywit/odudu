import { createBudget, declaresMoreThan, type Budget } from '#/services/byte-budget';
import { browserResponseHeaders } from '#/services/proxy-headers';

export interface UpstreamCall {
  url: string;
  method: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export interface UpstreamLimits {
  maxBodyBytes: number;
  timeoutMs: number;
  fetch: typeof fetch;
}

export type UpstreamOutcome =
  | { kind: 'response'; response: Response }
  | { kind: 'too-large' | 'answer-too-large' | 'timeout' | 'failed' };

class BodyTooLarge extends Error {}

// Passes chunks through until the budget is spent, then fails the stream, so
// the bytes beyond the limit are never forwarded and nothing is held but the
// chunk in hand.
function limited(source: ReadableStream<Uint8Array>, budget: Budget): ReadableStream<Uint8Array> {
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (budget.spend(chunk.byteLength)) controller.enqueue(chunk);
        else controller.error(new BodyTooLarge('the body is over the limit'));
      },
    }),
  );
}

function forBrowser(response: Response, limit: number): UpstreamOutcome {
  if (declaresMoreThan(response.headers.get('content-length'), limit)) {
    response.body?.cancel().catch(() => undefined);
    return { kind: 'answer-too-large' };
  }
  const body = response.body === null ? null : limited(response.body, createBudget(limit));
  return {
    kind: 'response',
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: browserResponseHeaders(response.headers),
    }),
  };
}

// Sends the call and hands back the answer, never following a redirect. The
// timeout covers the wait for the upstream to start answering; the body then
// streams for as long as it takes, within the byte limit.
export async function sendUpstream(
  call: UpstreamCall,
  limits: UpstreamLimits,
): Promise<UpstreamOutcome> {
  if (declaresMoreThan(call.headers.get('content-length'), limits.maxBodyBytes)) {
    return { kind: 'too-large' };
  }
  const budget = createBudget(limits.maxBodyBytes);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, limits.timeoutMs);
  try {
    const response = await limits.fetch(call.url, {
      method: call.method,
      headers: call.headers,
      body: call.body === null ? null : limited(call.body, budget),
      redirect: 'manual',
      signal: controller.signal,
      duplex: 'half',
    });
    return forBrowser(response, limits.maxBodyBytes);
  } catch {
    if (budget.exceeded()) return { kind: 'too-large' };
    return { kind: controller.signal.aborted ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
