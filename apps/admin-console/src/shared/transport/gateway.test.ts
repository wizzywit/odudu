import { listSubjectsResponseSchema, subjectSchema } from '@odudu/contracts/admin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createSessionEvents } from '#/shared/service/sessionEvents.ts';
import { createGateway, type Fetch, type Method } from '#/shared/transport/gateway.ts';

const SUBJECT = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  type: 'user',
  username: 'hopper',
  email: 'hopper@example.com',
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};
const ETAG = '"e0e294cbbb3a1a76ae2d1962269e63e5016b9ac6c24613abe0a66c650dc679be"';
const SUBJECT_PATH = 'admin/tenants/acme/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}
type Answer = Response | Error;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function problem(status: number, type: string, title: string): Response {
  return new Response(JSON.stringify({ status, type, title, instance: '01a0e77f' }), {
    status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  });
}

function harness(...answers: Answer[]) {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    const next = answers.shift() ?? new Error('the fake fetch ran out of answers');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const log = vi.fn<(message: string) => void>();
  const events = createSessionEvents();
  const gateway = createGateway({ fetch, sleep, log, events });
  return { gateway, calls, sleep, log, events };
}

function headersOf(call: Call | undefined): Headers {
  return new Headers(call?.init.headers);
}

const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

describe('gateway.request, what every request carries', () => {
  it.each(METHODS)(
    '%s is same-origin, under /console/api/, and never sends Authorization',
    async (method) => {
      const { gateway, calls } = harness(json(SUBJECT));

      await gateway.request(method, SUBJECT_PATH, { schema: subjectSchema });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(`/console/api/${SUBJECT_PATH}`);
      expect(calls[0]?.init.method).toBe(method);
      expect(calls[0]?.init.credentials).toBe('same-origin');
      expect(headersOf(calls[0]).has('authorization')).toBe(false);
    },
  );

  it.each(METHODS.filter((m) => m !== 'GET'))('%s carries X-Odudu-Console: 1', async (method) => {
    const { gateway, calls } = harness(json(SUBJECT));

    await gateway.request(method, SUBJECT_PATH, { schema: subjectSchema });

    expect(headersOf(calls[0]).get('x-odudu-console')).toBe('1');
  });

  it('GET carries no X-Odudu-Console', async () => {
    const { gateway, calls } = harness(json(SUBJECT));

    await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(headersOf(calls[0]).has('x-odudu-console')).toBe(false);
  });

  it('sends a JSON body with its content-type, and If-Match when given', async () => {
    const { gateway, calls } = harness(json(SUBJECT, 200, { etag: '"next"' }));

    await gateway.request('PATCH', SUBJECT_PATH, {
      body: { email: 'hopper@example.com' },
      ifMatch: ETAG,
      schema: subjectSchema,
    });

    const headers = headersOf(calls[0]);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('if-match')).toBe(ETAG);
    expect(calls[0]?.init.body).toBe('{"email":"hopper@example.com"}');
  });

  it('sends neither a body nor a content-type when there is no body', async () => {
    const { gateway, calls } = harness(json({ redirect: 'http://localhost/logout' }));

    await gateway.request('POST', 'admin/tenants/acme/subjects', { schema: z.unknown() });

    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0]).has('content-type')).toBe(false);
  });

  it('refuses a path that would leave /console/api/', async () => {
    const { gateway, calls } = harness(json(SUBJECT));

    await expect(
      gateway.request('GET', '/admin/tenants/acme/subjects', { schema: subjectSchema }),
    ).rejects.toThrow(/relative to \/console\/api\//);
    expect(calls).toHaveLength(0);
  });

  it.each([
    '../auth/logout',
    '../../etc/passwd',
    '%2e%2e/auth/logout',
    '%2E%2e/auth/logout',
    '.%2E/auth/logout',
    'a/../../x',
    'admin/..\\..\\auth',
    '\\\\host/x',
    '//host/x',
  ])('refuses %s, which resolves outside /console/api/', async (path) => {
    const { gateway, calls } = harness(json(SUBJECT));

    await expect(gateway.request('GET', path, { schema: subjectSchema })).rejects.toThrow(
      TypeError,
    );
    expect(calls).toHaveLength(0);
  });

  it('sends the resolved path with its query', async () => {
    const { gateway, calls } = harness(json({ items: [] }));

    await gateway.request('GET', 'admin/tenants/acme/./subjects?limit=1&search=a%20b', {
      schema: z.unknown(),
    });

    expect(calls[0]?.url).toBe('/console/api/admin/tenants/acme/subjects?limit=1&search=a%20b');
  });
});

describe('gateway.request, a success', () => {
  it('parses the body with the contract schema and returns the ETag', async () => {
    const { gateway } = harness(json(SUBJECT, 200, { etag: ETAG }));

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(result).toEqual({ ok: true, status: 200, data: SUBJECT, etag: ETAG, next: null });
  });

  it('returns the next cursor from the Link header', async () => {
    const link = '</console/api/admin/tenants/acme/subjects?limit=1&cursor=c2>; rel="next"';
    const { gateway } = harness(json({ items: [SUBJECT], next: 'c2' }, 200, { link }));

    const result = await gateway.request('GET', 'admin/tenants/acme/subjects?limit=1', {
      schema: listSubjectsResponseSchema,
    });

    expect(result.ok && result.next).toBe('c2');
  });

  it('parses an empty 204 as undefined', async () => {
    const { gateway } = harness(new Response(null, { status: 204 }));

    const result = await gateway.request('DELETE', SUBJECT_PATH, { schema: z.undefined() });

    expect(result).toEqual({ ok: true, status: 204, data: undefined, etag: null, next: null });
  });
});

describe('gateway.request, a body the contract does not describe', () => {
  it('is a schema failure, logged once with the path and issue paths but not the body', async () => {
    const leaked = { ...SUBJECT, email: 42, username: 'secret-username' };
    const { gateway, log } = harness(json(leaked));

    const result = await gateway.request('GET', `${SUBJECT_PATH}?search=secret-query`, {
      schema: subjectSchema,
    });

    expect(result).toEqual({ ok: false, kind: 'schema' });
    expect(log).toHaveBeenCalledOnce();
    const message = log.mock.calls[0]?.[0] ?? '';
    expect(message).toContain(`GET ${SUBJECT_PATH}`);
    expect(message).toContain('email');
    expect(message).not.toContain('secret-username');
    expect(message).not.toContain('42');
    expect(message).not.toContain('secret-query');
  });

  it('is a schema failure when a success body is not JSON', async () => {
    const { gateway, log } = harness(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(result).toEqual({ ok: false, kind: 'schema' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).not.toContain('<html>');
  });
});

describe('gateway.request, a refusal', () => {
  it('returns the problem for an HTTP status rather than throwing', async () => {
    const { gateway } = harness(problem(412, 'about:blank', 'Precondition Failed'));

    const result = await gateway.request('PATCH', SUBJECT_PATH, {
      body: {},
      ifMatch: ETAG,
      schema: subjectSchema,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'problem',
      problem: {
        status: 412,
        type: 'about:blank',
        title: 'Precondition Failed',
        instance: '01a0e77f',
      },
    });
  });

  it('emits sessionEnded on a 401 console-session-ended', async () => {
    const { gateway, events } = harness(
      problem(401, 'about:blank#console-session-ended', 'Unauthorized'),
    );
    const ended = vi.fn();
    events.on('sessionEnded', ended);

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(ended).toHaveBeenCalledOnce();
    expect(!result.ok && result.kind).toBe('problem');
  });

  it('does not emit sessionEnded on a plain 401', async () => {
    const { gateway, events } = harness(problem(401, 'about:blank', 'Unauthorized'));
    const ended = vi.fn();
    events.on('sessionEnded', ended);

    await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(ended).not.toHaveBeenCalled();
  });

  it('still answers when a sessionEnded subscriber throws', async () => {
    const { gateway, events, log } = harness(
      problem(401, 'about:blank#console-session-ended', 'Unauthorized'),
    );
    events.on('sessionEnded', () => {
      throw new Error('subscriber broke');
    });

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(!result.ok && result.kind).toBe('problem');
    expect(log).toHaveBeenCalledOnce();
  });

  it('treats a 428 as a console defect: logged, and never the user problem', async () => {
    const { gateway, log } = harness(problem(428, 'about:blank', 'Precondition Required'));

    const result = await gateway.request('PUT', `${SUBJECT_PATH}/groups`, {
      body: [],
      schema: z.unknown(),
    });

    expect(result).toEqual({ ok: false, kind: 'defect' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain(`PUT ${SUBJECT_PATH}/groups`);
    expect(log.mock.calls[0]?.[0]).toContain('428');
    expect(log.mock.calls[0]?.[0]).toContain('required If-Match');
    expect(log.mock.calls[0]?.[0]).not.toMatch(/without|omit|missing/);
  });
});

describe('gateway.request, the subject this tab believes it is', () => {
  it('names it on every admin request once told, and never on the session read', async () => {
    const { gateway, calls } = harness(json({}), json({}), json({}), json({}));
    await gateway.request('GET', SUBJECT_PATH, { schema: z.unknown() });
    gateway.believe('s1');
    await gateway.request('POST', 'admin/tenants/acme/scopes', { schema: z.unknown(), body: {} });
    await gateway.request('GET', 'session', { schema: z.unknown() });
    gateway.believe(null);
    await gateway.request('GET', SUBJECT_PATH, { schema: z.unknown() });

    expect(calls.map((call) => headersOf(call).get('x-odudu-console-subject'))).toEqual([
      null,
      's1',
      null,
      null,
    ]);
  });

  it('emits principalChanged on a 409 console-principal-changed, and not on a plain 409', async () => {
    const { gateway, events } = harness(
      problem(409, 'about:blank#console-principal-changed', 'Conflict'),
      problem(409, 'about:blank', 'Conflict'),
    );
    const changed = vi.fn();
    events.on('principalChanged', changed);

    const refused = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });
    await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(changed).toHaveBeenCalledOnce();
    expect(!refused.ok && refused.kind).toBe('problem');
  });
});

describe('gateway.request, retries', () => {
  const offline = () => new TypeError('Failed to fetch');

  it('retries a GET twice on a network failure, backing off', async () => {
    const { gateway, calls, sleep } = harness(offline(), offline(), json(SUBJECT));

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500]);
  });

  it('gives up on a GET after three attempts, as a network failure', async () => {
    const { gateway, calls } = harness(offline(), offline(), offline(), json(SUBJECT));

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(result).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(3);
  });

  it.each([503, 504])('retries a GET answered %i', async (status) => {
    const { gateway, calls } = harness(
      problem(status, 'about:blank', 'Service Unavailable'),
      json(SUBJECT),
    );

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a GET answered 502, which the gateway only sends after waiting', async () => {
    const { gateway, calls, sleep } = harness(
      problem(502, 'about:blank', 'Bad Gateway'),
      json(SUBJECT),
    );

    const result = await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(!result.ok && result.kind).toBe('problem');
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a GET refused with a 4xx', async () => {
    const { gateway, calls } = harness(problem(404, 'about:blank#not-found', 'Not Found'));

    await gateway.request('GET', SUBJECT_PATH, { schema: subjectSchema });

    expect(calls).toHaveLength(1);
  });

  it('never retries a POST, whose outcome is unknown', async () => {
    const { gateway, calls, sleep } = harness(offline(), json(SUBJECT));

    const result = await gateway.request('POST', 'admin/tenants/acme/subjects', {
      body: { username: 'babbage' },
      schema: subjectSchema,
    });

    expect(result).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never retries a POST answered 503', async () => {
    const { gateway, calls } = harness(problem(503, 'about:blank', 'Service Unavailable'));

    await gateway.request('POST', 'admin/tenants/acme/subjects', {
      body: {},
      schema: subjectSchema,
    });

    expect(calls).toHaveLength(1);
  });

  it.each(['PATCH', 'PUT'] as const)('retries a %s once on a network failure', async (method) => {
    const { gateway, calls } = harness(offline(), offline(), json(SUBJECT));

    const result = await gateway.request(method, SUBJECT_PATH, {
      body: {},
      ifMatch: ETAG,
      schema: subjectSchema,
    });

    expect(result).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.body).toBe('{}');
    expect(headersOf(calls[1]).get('if-match')).toBe(ETAG);
  });

  it.each(['PATCH', 'PUT'] as const)(
    'never retries a %s without If-Match, whose duplicate nothing would catch',
    async (method) => {
      const { gateway, calls, sleep } = harness(offline(), json(SUBJECT));

      const result = await gateway.request(method, SUBJECT_PATH, {
        body: {},
        schema: subjectSchema,
      });

      expect(result).toEqual({ ok: false, kind: 'network' });
      expect(calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it.each(['PATCH', 'PUT'] as const)('does not retry a %s answered 503', async (method) => {
    const { gateway, calls } = harness(problem(503, 'about:blank', 'Service Unavailable'));

    await gateway.request(method, SUBJECT_PATH, { body: {}, ifMatch: ETAG, schema: subjectSchema });

    expect(calls).toHaveLength(1);
  });

  it('never retries a DELETE', async () => {
    const { gateway, calls } = harness(offline(), new Response(null, { status: 204 }));

    const result = await gateway.request('DELETE', SUBJECT_PATH, {
      ifMatch: ETAG,
      schema: z.undefined(),
    });

    expect(result).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(1);
  });
});

describe('gateway.request, a request that never answers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts after the timeout and reports a network failure', async () => {
    vi.useFakeTimers();
    const calls: Call[] = [];
    const fetch: Fetch = (url, init) => {
      calls.push({ url, init });
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    };
    const gateway = createGateway({
      fetch,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      events: createSessionEvents(),
      timeoutMs: 1000,
    });

    const pending = gateway.request('POST', 'admin/tenants/acme/subjects', {
      body: {},
      schema: subjectSchema,
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(1);
  });

  it('keeps the timeout running while the body is still arriving', async () => {
    vi.useFakeTimers();
    const fetch: Fetch = (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const gateway = createGateway({
      fetch,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      events: createSessionEvents(),
      timeoutMs: 1000,
    });

    const pending = gateway.request('POST', 'admin/tenants/acme/subjects', {
      body: {},
      schema: subjectSchema,
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: false, kind: 'network' });
  });
});

describe('gateway.download, a body kept as the bytes the server sent', () => {
  const EXPORT_PATH = 'admin/tenants/acme/export';
  const DOCUMENT = '{"version":1,"from_a_newer_server":{"kept":"ü — 𝄞"},"omitted":[]}';

  function document(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/vnd.odudu.tenant+json' },
    });
  }

  it('answers the text and its content type, members the console does not know included', async () => {
    const { gateway, calls } = harness(document(DOCUMENT));
    gateway.believe('s1');

    const result = await gateway.download('GET', `${EXPORT_PATH}?include=subjects`);

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { text: DOCUMENT, contentType: 'application/vnd.odudu.tenant+json' },
      etag: null,
      next: null,
    });
    expect(calls[0]?.url).toBe(`/console/api/${EXPORT_PATH}?include=subjects`);
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(headersOf(calls[0]).get('x-odudu-console-subject')).toBe('s1');
  });

  it('emits sessionEnded on a 401 console-session-ended, and answers the problem', async () => {
    const { gateway, events } = harness(
      problem(401, 'about:blank#console-session-ended', 'Unauthorized'),
    );
    const ended = vi.fn();
    events.on('sessionEnded', ended);

    const result = await gateway.download('GET', EXPORT_PATH);

    expect(result).toMatchObject({ ok: false, kind: 'problem', problem: { status: 401 } });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('emits principalChanged on a 409 console-principal-changed', async () => {
    const { gateway, events } = harness(
      problem(409, 'about:blank#console-principal-changed', 'Conflict'),
    );
    const changed = vi.fn();
    events.on('principalChanged', changed);

    await gateway.download('GET', EXPORT_PATH);

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure as any GET does, and reports one that persists', async () => {
    const { gateway, calls } = harness(
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
    );

    expect(await gateway.download('GET', EXPORT_PATH)).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(3);
  });

  it('refuses a path that would leave /console/api/', async () => {
    const { gateway } = harness();
    await expect(gateway.download('GET', '../session')).rejects.toThrow(TypeError);
  });
});
