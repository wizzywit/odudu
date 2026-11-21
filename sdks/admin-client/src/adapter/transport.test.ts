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

describe('the per-attempt timeout', () => {
  const sleep = (): Promise<void> => Promise.resolve();
  const sendTo = (origin: string, timeoutMs: number) =>
    createTransport({ fetch: (request) => fetch(request), sleep, timeoutMs });

  it('fails a call to a server that never answers with a RequestTimeoutError', async () => {
    const api = await startFakeApi(() => ({ status: 200, hang: true }));
    try {
      const started = Date.now();
      const failure = await sendTo(
        api.origin,
        80,
      )(new Request(`${api.origin}/x`, { method: 'POST', body: '{}' })).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(RequestTimeoutError);
      expect((failure as Error).message).toContain('80 ms');
      expect(Date.now() - started).toBeLessThan(1500);
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });

  it('retries a GET whose first attempt timed out, and the repeat answers', async () => {
    const api = await startFakeApi((_request, index) =>
      index === 0 ? { status: 200, hang: true } : { status: 200, body: 'fast' },
    );
    try {
      const response = await sendTo(api.origin, 80)(new Request(`${api.origin}/x`));
      expect(await response.text()).toBe('fast');
      expect(api.requests).toHaveLength(2);
    } finally {
      await api.close();
    }
  });

  it('stops after the bounded retries when every attempt times out', async () => {
    const api = await startFakeApi(() => ({ status: 200, hang: true }));
    try {
      const failure = await sendTo(
        api.origin,
        50,
      )(new Request(`${api.origin}/x`)).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RequestTimeoutError);
      expect(api.requests).toHaveLength(3);
    } finally {
      await api.close();
    }
  });

  it('still lets the caller abort, and says nothing about a timeout then', async () => {
    const api = await startFakeApi(() => ({ status: 200, hang: true }));
    try {
      const controller = new AbortController();
      const pending = sendTo(
        api.origin,
        5_000,
      )(new Request(`${api.origin}/x`, { signal: controller.signal })).catch(
        (error: unknown) => error,
      );
      setTimeout(() => {
        controller.abort();
      }, 30);
      const failure = await pending;
      expect(failure).not.toBeInstanceOf(RequestTimeoutError);
      expect((failure as Error).name).toBe('AbortError');
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
});
