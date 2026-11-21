import { createBudget, declaresMoreThan, type Budget } from '#/services/byte-budget';
import { browserResponseHeaders } from '#/services/proxy-headers';

export interface UpstreamCall {
  url: string;
  method: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  // Aborts the call in every phase: the browser left.
  signal: AbortSignal;
}

export interface UpstreamLimits {
  maxBodyBytes: number;
  timeoutMs: number;
  // The longest an answer's body may go without a chunk.
  idleMs: number;
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

// Cuts the body off, and the upstream request with it, when no chunk arrives
// for `idleMs`. The clock runs from the moment the headers arrived.
function withIdleLimit(
  source: ReadableStream<Uint8Array>,
  idleMs: number,
  abort: () => void,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(abort, idleMs);
  };
  arm();
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        arm();
        controller.enqueue(chunk);
      },
      flush() {
        clearTimeout(timer);
      },
      cancel() {
        clearTimeout(timer);
      },
    }),
  );
}

function forBrowser(
  response: Response,
  limit: number,
  idle: { ms: number; abort: () => void },
): UpstreamOutcome {
  if (declaresMoreThan(response.headers.get('content-length'), limit)) {
    response.body?.cancel().catch(() => undefined);
    return { kind: 'answer-too-large' };
  }
  const body =
    response.body === null
      ? null
      : withIdleLimit(limited(response.body, createBudget(limit)), idle.ms, idle.abort);
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
      signal: AbortSignal.any([controller.signal, call.signal]),
      duplex: 'half',
    });
    return forBrowser(response, limits.maxBodyBytes, {
      ms: limits.idleMs,
      abort: () => {
        controller.abort();
      },
    });
  } catch {
    if (budget.exceeded()) return { kind: 'too-large' };
    return { kind: controller.signal.aborted ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
