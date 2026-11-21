import { describe, expect, it } from 'vitest';
import { createTransport } from '#/adapter/transport';
import { RequestTimeoutError } from '#/services/problem';
import { startFakeApi } from '#/testing/fake-api';
import { ProblemError } from '#/services/problem';

function transport(
  replies: (Response | Error)[],
  waits: number[] = [],
): {
  send: (request: Request) => Promise<Response>;
  calls: () => number;
} {
  let calls = 0;
  const send = createTransport({
    fetch: () => {
      const next = replies[calls++] ?? new Response(null, { status: 200 });
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return { send, calls: () => calls };
}

const get = (): Request => new Request('http://api.test/x');

describe('the transport', () => {
  it('answers an opaque redirect with a ProblemError that says redirects are not followed', async () => {
    const opaque = {
      ok: false,
      status: 0,
      type: 'opaqueredirect',
      headers: new Headers(),
      body: null,
    } as unknown as Response;
    const failure = await transport([opaque])
      .send(get())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProblemError);
    expect((failure as ProblemError).status).toBe(0);
    expect((failure as ProblemError).message).toContain('redirects are not followed');
  });

  it('honours Retry-After in seconds, capped at 5 s', async () => {
    const waits: number[] = [];
    const { send } = transport(
      [
        new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
        new Response(null, { status: 503, headers: { 'retry-after': '60' } }),
        new Response(null, { status: 200 }),
      ],
      waits,
    );
    await send(get());
    expect(waits).toEqual([2000, 5000]);
  });

  it('retries a GET after a network error', async () => {
    const { send, calls } = transport([new TypeError('fetch failed'), new Response('ok')]);
    expect((await send(get())).status).toBe(200);
    expect(calls()).toBe(2);
  });

  it.each([501, 505, 404])('does not retry a %i', async (status) => {
    const { send, calls } = transport([new Response(null, { status })]);
    await expect(send(get())).rejects.toBeInstanceOf(ProblemError);
    expect(calls()).toBe(1);
  });

  it.each([500, 502, 503, 504, 429])('retries a %i', async (status) => {
    const { send, calls } = transport([new Response(null, { status }), new Response('ok')]);
    await send(get());
    expect(calls()).toBe(2);
  });
});

// A fetch that answers only when told to: with the next scripted response, or
// never, until the request's own signal aborts it. No network, so what these
// tests wait for is the timeout and nothing else.
function scripted(script: ('hang' | Response)[]): {
  fetch: (request: Request) => Promise<Response>;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: (request) => {
      const step = script[calls++] ?? 'hang';
      if (step !== 'hang') return Promise.resolve(step);
      return new Promise<Response>((_resolve, reject) => {
        const fail = (): void => {
          reject(request.signal.reason as Error);
        };
        if (request.signal.aborted) fail();
        else request.signal.addEventListener('abort', fail, { once: true });
      });
    },
  };
}

async function eventually(condition: () => boolean, deadlineMs = 5_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (!condition() && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('the per-attempt timeout', () => {
  const sleep = (): Promise<void> => Promise.resolve();
  const timed = (fetcher: (request: Request) => Promise<Response>, timeoutMs: number) =>
    createTransport({ fetch: fetcher, sleep, timeoutMs });
  const get = (): Request => new Request('http://api.test/x');

  it('fails a call to a server that never answers with a RequestTimeoutError', async () => {
    const api = await startFakeApi(() => ({ status: 200, hang: true }));
    try {
      const failure = await timed(
        (request) => fetch(request),
        500,
      )(new Request(`${api.origin}/x`, { method: 'POST', body: '{}' })).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(RequestTimeoutError);
      expect((failure as Error).message).toContain('500 ms');
      // What the server saw is a separate question, asked after the fact.
      await eventually(() => api.requests.length > 0);
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });

  it('retries a GET whose first attempt timed out, and the repeat answers', async () => {
    const { fetch: send, calls } = scripted(['hang', new Response('fast')]);
    const response = await timed(send, 40)(get());
    expect(await response.text()).toBe('fast');
    expect(calls()).toBe(2);
  });

  it('stops after the bounded retries when every attempt times out', async () => {
    const { fetch: send, calls } = scripted(['hang', 'hang', 'hang', 'hang']);
    const failure = await timed(send, 30)(get()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RequestTimeoutError);
    expect(calls()).toBe(3);
  });

  it('does not repeat a POST without a key', async () => {
    const { fetch: send, calls } = scripted(['hang', new Response('late')]);
    const failure = await timed(
      send,
      30,
    )(new Request('http://api.test/x', { method: 'POST', body: '{}' })).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RequestTimeoutError);
    expect(calls()).toBe(1);
  });

  it('still lets the caller abort, and says nothing about a timeout then', async () => {
    const { fetch: send, calls } = scripted(['hang']);
    const controller = new AbortController();
    const pending = timed(
      send,
      60_000,
    )(new Request('http://api.test/x', { signal: controller.signal })).catch(
      (error: unknown) => error,
    );
    await eventually(() => calls() === 1);
    controller.abort();
    const failure = await pending;
    expect(failure).not.toBeInstanceOf(RequestTimeoutError);
    expect((failure as Error).name).toBe('AbortError');
    expect(calls()).toBe(1);
  });
});
