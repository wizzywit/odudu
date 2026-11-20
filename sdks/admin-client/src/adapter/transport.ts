import { readProblemText } from '#/adapter/body';
import { problemFromBody, ProblemError } from '#/services/problem';
import { isRetryableStatus, MAX_RETRIES, mayRetry, retryDelayMs } from '#/services/retry';

export interface Transport {
  fetch: (request: Request) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
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

/**
 * Sends a request, repeating it at most twice when the repeat is harmless and
 * the server or the network failed, and throws a `ProblemError` for a response
 * that is not a success. A repeat is the same request, so it carries the same
 * `Idempotency-Key`. A retried DELETE whose first answer was lost can answer
 * 404 because the first attempt took effect.
 */
export function createTransport(transport: Transport): (request: Request) => Promise<Response> {
  return async (request) => {
    const retries = mayRetry(request.method, request.headers) ? MAX_RETRIES : 0;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= retries;
      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await transport.fetch(last ? request : request.clone());
      } catch (error) {
        failure = error;
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
