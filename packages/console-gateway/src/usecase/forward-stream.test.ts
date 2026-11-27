import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ConsoleSessionRecord } from '#/repository/console-sessions';
import { type AdminCall, type AdminStreamResponse, type Caller } from '#/service/odudu-port';
import { type ForwardDeps } from '#/usecase/forward';
import { forwardAdminStream } from '#/usecase/forward-stream';

const session = { id: 's1', subjectId: 'sub-1', tenantId: 't1' } as unknown as ConsoleSessionRecord;
let resolved: 'ok' | 'ended' = 'ok';
const ended: string[] = [];

vi.mock('#/usecase/resolve-session', () => ({
  resolveSession: () =>
    Promise.resolve(resolved === 'ok' ? { kind: 'ok', session } : { kind: 'ended' }),
  endSession: () => {
    ended.push('ended');
    return Promise.resolve();
  },
}));
vi.mock('#/usecase/fresh-access-token', () => ({
  freshAccessToken: () => Promise.resolve({ kind: 'ok', accessToken: 'at' }),
}));
// A 401 is confirmed at the tenant only through its own whoami call; the
// refusal check is what these tests steer.
let refusedAtTenant = false;
vi.mock('@odudu/db', () => ({
  withTenant: (_db: unknown, _tenant: string, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('#/repository/tenants', () => ({
  tenantNameRepository: () => ({ nameOf: () => Promise.resolve('acme') }),
}));

const FROM: Caller = { ip: '127.0.0.1', requestId: 'r1' };

interface Port {
  calls: { call: AdminCall; signal: AbortSignal }[];
  upstream: PassThrough;
  destroyed: number;
  status: number;
}

function port(status = 200): { deps: ForwardDeps; seen: Port } {
  const seen: Port = { calls: [], upstream: new PassThrough(), destroyed: 0, status };
  const odudu = {
    forwardStream: (call: AdminCall, signal: AbortSignal): Promise<AdminStreamResponse> => {
      seen.calls.push({ call, signal });
      return Promise.resolve({
        status: seen.status,
        headers: { 'content-type': 'text/event-stream', 'set-cookie': 'x=1' },
        body: seen.upstream,
        destroy: () => {
          seen.destroyed += 1;
        },
      });
    },
    forward: () =>
      Promise.resolve({ status: refusedAtTenant ? 401 : 200, headers: {}, body: Buffer.alloc(0) }),
  };
  return { deps: { odudu, database: { db: {} } } as unknown as ForwardDeps, seen };
}

function callWith(signal: AbortSignal) {
  return {
    method: 'POST' as const,
    path: '/admin/tenants/acme/assistant/conversations/c1/messages',
    headers: { cookie: 'c=1', 'content-type': 'application/json', accept: 'text/event-stream' },
    body: Buffer.from('{}'),
    believedSubject: 'sub-1',
    from: FROM,
    now: new Date(),
    signal,
  };
}

afterEach(() => {
  resolved = 'ok';
  refusedAtTenant = false;
  ended.length = 0;
});

describe('forwardAdminStream', () => {
  it('sends the call upstream with the fresh token and returns the body unread', async () => {
    const { deps, seen } = port();
    const result = await forwardAdminStream(deps, callWith(new AbortController().signal));
    if (result.kind !== 'streaming') throw new Error(result.kind);
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('text/event-stream');
    expect(result.headers).not.toHaveProperty('set-cookie');
    expect(seen.calls[0]?.call.headers.authorization).toBe('Bearer at');
    expect(seen.calls[0]?.call.headers.cookie).toBeUndefined();

    seen.upstream.write('data: first\n\n');
    const first = await new Promise<string>((resolve) => {
      result.body.once('data', (chunk: Buffer) => {
        resolve(chunk.toString());
      });
    });
    expect(first).toBe('data: first\n\n');
    expect(seen.upstream.writableEnded).toBe(false);
  });

  it('destroys the upstream response when the browser goes', async () => {
    const { deps, seen } = port();
    const gone = new AbortController();
    await forwardAdminStream(deps, callWith(gone.signal));
    expect(seen.destroyed).toBe(0);
    gone.abort();
    expect(seen.destroyed).toBe(1);
    expect(seen.calls[0]?.signal).toBe(gone.signal);
  });

  it('refuses without calling the upstream when the session has ended', async () => {
    resolved = 'ended';
    const { deps, seen } = port();
    const result = await forwardAdminStream(deps, callWith(new AbortController().signal));
    expect(result.kind).toBe('ended');
    expect(seen.calls).toHaveLength(0);
  });

  it('refuses a tab that believes it is another person, before the upstream is called', async () => {
    const { deps, seen } = port();
    const result = await forwardAdminStream(deps, {
      ...callWith(new AbortController().signal),
      believedSubject: 'sub-2',
    });
    expect(result.kind).toBe('principal-changed');
    expect(seen.calls).toHaveLength(0);
  });

  it('ends the session on a 401 the tenant confirms, and drops the upstream', async () => {
    refusedAtTenant = true;
    const { deps, seen } = port(401);
    const result = await forwardAdminStream(deps, callWith(new AbortController().signal));
    expect(result.kind).toBe('ended');
    expect(ended).toEqual(['ended']);
    expect(seen.destroyed).toBe(1);
  });

  it('streams a 401 the tenant does not confirm, which is the admin API refusing the path', async () => {
    const { deps } = port(401);
    const result = await forwardAdminStream(deps, callWith(new AbortController().signal));
    expect(result.kind).toBe('streaming');
    expect(ended).toEqual([]);
  });
});
