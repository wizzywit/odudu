import { readProblemText } from '#/adapter/body';
import { problemFromBody, ProblemError, RequestTimeoutError } from '#/services/problem';
import { isRetryableStatus, MAX_RETRIES, mayRetry, retryDelayMs } from '#/services/retry';

export interface Transport {
  fetch: (request: Request) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  // The longest one attempt may take; none when omitted.
  timeoutMs?: number | undefined;
}

const REDIRECT_MESSAGE =
  'the server answered with a redirect; redirects are not followed so the token is never sent elsewhere';

async function toProblem(response: Response): Promise<ProblemError> {
  if (response.type === 'opaqueredirect' || response.status === 0) {
    const init = problemFromBody(response.status, undefined);
    return new ProblemError({ ...init, detail: REDIRECT_MESSAGE }, response);
  }
  const body = await readProblemText(response);
  return new ProblemError(problemFromBody(response.status, body), response);
}

// The caller's signal and a deadline as one signal. `AbortSignal.any` is in
// Node 20.3 and later and in browsers since 2023-24; on a runtime without it a
// controller follows both.
function withDeadline(caller: AbortSignal, deadline: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([caller, deadline]);
  const controller = new AbortController();
  const abort = (from: AbortSignal) => () => {
    controller.abort(from.reason);
  };
  for (const signal of [caller, deadline]) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', abort(signal), { once: true });
  }
  return controller.signal;
}

/**
 * Sends a request, repeating it at most twice when the repeat is harmless and
 * the server or the network failed, and throws a `ProblemError` for a response
 * that is not a success. A repeat is the same request, so it carries the same
 * `Idempotency-Key`. A retried DELETE whose first answer was lost can answer
 * 404 because the first attempt took effect. An attempt that gets no answer
 * within `timeoutMs` counts as a network failure, and the last one is thrown
 * as a `RequestTimeoutError`.
 */
export function createTransport(transport: Transport): (request: Request) => Promise<Response> {
  return async (request) => {
    const retries = mayRetry(request.method, request.headers) ? MAX_RETRIES : 0;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= retries;
      let response: Response | undefined;
      let failure: unknown;
      const deadline =
        transport.timeoutMs === undefined ? undefined : AbortSignal.timeout(transport.timeoutMs);
      try {
        const source = last ? request : request.clone();
        response = await transport.fetch(
          deadline === undefined
            ? source
            : new Request(source, { signal: withDeadline(request.signal, deadline) }),
        );
      } catch (error) {
        failure = timedOut(error, request, deadline, transport.timeoutMs);
      }
      if (response?.ok === true) return response;
      if (response !== undefined && (last || !isRetryableStatus(response.status))) {
        throw await toProblem(response);
      }
      if (response === undefined && (last || request.signal.aborted)) throw failure;
      await response?.body?.cancel();
      await transport.sleep(retryDelayMs(attempt, response?.headers.get('retry-after') ?? null));
    }
  };
}

// A failure after the deadline passed and the caller did not abort is the
// timeout; anything else is what `fetch` threw.
function timedOut(
  error: unknown,
  request: Request,
  deadline: AbortSignal | undefined,
  timeoutMs: number | undefined,
): unknown {
  return deadline?.aborted === true && !request.signal.aborted && timeoutMs !== undefined
    ? new RequestTimeoutError(timeoutMs, { cause: error })
    : error;
}
