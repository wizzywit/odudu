import { describe, expect, it } from 'vitest';
import { createTransport } from '#/adapter/transport';
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
