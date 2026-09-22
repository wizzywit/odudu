import { describe, expect, it } from 'vitest';
import {
  sendLogouts,
  type ClaimedLogoutDelivery,
  type LogoutDeliveryResponse,
  type LogoutDeliveryTransport,
  type SendLogoutsDeps,
} from '#/usecase/send-logouts';

const NOW = new Date('2026-09-20T10:00:00.000Z');
const TOKEN = 'signed-logout-token';
const RESPONSE_TIMEOUT_MS = 20;

interface FakeRow {
  readonly id: string;
  readonly endpoint: string;
  logoutToken: string;
  delivered: boolean;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'delivery-1',
    endpoint: 'https://rp-one.example/backchannel',
    logoutToken: TOKEN,
    delivered: false,
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    ...overrides,
  };
}

const MAX_ATTEMPTS = 5;

/** A queue in memory, standing in for `logoutDeliveryRepository`. */
function fakeQueue(rows: readonly FakeRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    byId,
    claimDue(now: Date): Promise<ClaimedLogoutDelivery[]> {
      const due = [...byId.values()].filter(
        (r) => !r.delivered && r.attempts < MAX_ATTEMPTS && r.nextAttemptAt <= now,
      );
      return Promise.resolve(
        due.map((r) => {
          r.attempts += 1;
          return { id: r.id, endpoint: r.endpoint, logoutToken: r.logoutToken };
        }),
      );
    },
    markDelivered(id: string): Promise<boolean> {
      const r = byId.get(id);
      if (r === undefined || r.delivered) return Promise.resolve(false);
      r.delivered = true;
      return Promise.resolve(true);
    },
    markFailed(id: string, now: Date, error: string): Promise<void> {
      const r = byId.get(id);
      if (r === undefined) return Promise.resolve();
      r.attempts += 1;
      r.lastError = error;
      r.nextAttemptAt = new Date(now.getTime() + 60_000);
      return Promise.resolve();
    },
    markAbandoned(id: string, now: Date, error: string): Promise<void> {
      const r = byId.get(id);
      if (r === undefined) return Promise.resolve();
      r.attempts = MAX_ATTEMPTS;
      r.lastError = error;
      r.nextAttemptAt = now;
      return Promise.resolve();
    },
  };
}

interface RecordedCall {
  readonly url: string;
  readonly method: 'POST';
  readonly contentType: string;
  readonly body: string;
}

interface RecordingTransport {
  readonly transport: LogoutDeliveryTransport;
  readonly calls: RecordedCall[];
}

function recordingTransport(response: LogoutDeliveryResponse): RecordingTransport {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: (endpoint, logoutToken) => {
      calls.push({
        url: endpoint,
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        body: `logout_token=${encodeURIComponent(logoutToken)}`,
      });
      return Promise.resolve(response);
    },
  };
}

function transportWith(status: number): LogoutDeliveryTransport {
  return () => Promise.resolve({ status });
}

// A bound the test itself enforces, rather than vitest's suite timeout: a
// pass that never returns fails this assertion in about `boundMs`, not in
// whatever the runner's own timeout happens to be — the failure reads as
// this test's own defect, not as an unrelated hang elsewhere in the suite.
function withinMs<T>(promise: Promise<T>, boundMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`sendLogouts did not return within ${String(boundMs)}ms`));
      }, boundMs);
    }),
  ]);
}

function hangingTransport(): LogoutDeliveryTransport & { aborted: boolean } {
  const state = { aborted: false };
  const transport: LogoutDeliveryTransport = (_endpoint, _logoutToken, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        state.aborted = true;
        reject(new Error('response deadline exceeded'));
      });
    });
  Object.defineProperty(transport, 'aborted', { get: () => state.aborted });
  return transport as LogoutDeliveryTransport & { aborted: boolean };
}

function failsFirstOnly(): LogoutDeliveryTransport {
  let calls = 0;
  return () => {
    calls += 1;
    return Promise.resolve({ status: calls === 1 ? 503 : 200 });
  };
}

const neverCalled: LogoutDeliveryTransport = () => {
  throw new Error('transport must not be called when the queue is empty');
};

function buildDeps(
  rows: readonly FakeRow[],
  transport: LogoutDeliveryTransport,
): SendLogoutsDeps & { queue: ReturnType<typeof fakeQueue> } {
  const queue = fakeQueue(rows);
  return {
    queue,
    claimDue: (now) => queue.claimDue(now),
    markDelivered: (id) => queue.markDelivered(id),
    markFailed: (id, now, error) => queue.markFailed(id, now, error),
    markAbandoned: (id, now, error) => queue.markAbandoned(id, now, error),
    transport,
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
  };
}

describe('sendLogouts', () => {
  it('posts logout_token as form encoding, and marks the row delivered on 200', async () => {
    const { transport, calls } = recordingTransport({ status: 200 });
    const deps = buildDeps([row()], transport);

    const result = await sendLogouts(deps, NOW);

    expect(calls[0]).toMatchObject({
      url: 'https://rp-one.example/backchannel',
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: `logout_token=${encodeURIComponent(TOKEN)}`,
    });
    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(deps.queue.byId.get('delivery-1')?.delivered).toBe(true);
  });

  it('[OIDC-BACKCHANNEL-2.5-02] retries a 503, which is recoverable', async () => {
    const deps = buildDeps([row()], transportWith(503));

    const result = await sendLogouts(deps, NOW);

    expect(result).toEqual({ delivered: 0, failed: 1 });
    const after = deps.queue.byId.get('delivery-1');
    expect(after?.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(after?.attempts).toBeLessThan(MAX_ATTEMPTS);
  });

  it('[OIDC-BACKCHANNEL-2.5-03] does not retry a 400, which is not', async () => {
    const deps = buildDeps([row()], transportWith(400));

    await sendLogouts(deps, NOW);

    const after = deps.queue.byId.get('delivery-1');
    expect(after?.attempts).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
  });

  it('retries a 429, asking to slow down rather than refusing the token', async () => {
    const deps = buildDeps([row()], transportWith(429));

    const result = await sendLogouts(deps, NOW);

    expect(result).toEqual({ delivered: 0, failed: 1 });
    const after = deps.queue.byId.get('delivery-1');
    expect(after?.attempts).toBeLessThan(MAX_ATTEMPTS);
  });

  it('abandons a relying party that accepts the connection and never answers', async () => {
    const transport = hangingTransport();
    const deps = buildDeps([row()], transport);

    const result = await withinMs(sendLogouts(deps, NOW), RESPONSE_TIMEOUT_MS * 5);

    expect(transport.aborted).toBe(true);
    expect(result).toEqual({ delivered: 0, failed: 1 });
  });

  it('keeps draining after one relying party fails', async () => {
    const rows = [
      row({ id: 'delivery-1', endpoint: 'https://rp-one.example/backchannel' }),
      row({ id: 'delivery-2', endpoint: 'https://rp-two.example/backchannel' }),
    ];
    const deps = buildDeps(rows, failsFirstOnly());

    const result = await sendLogouts(deps, NOW);

    expect(result).toEqual({ delivered: 1, failed: 1 });
  });

  it('delivers nothing and touches nothing when the queue is empty', async () => {
    const deps = buildDeps([], neverCalled);

    expect(await sendLogouts(deps, NOW)).toEqual({ delivered: 0, failed: 0 });
  });

  // markDelivered's own boolean is how the repository reports "a concurrent
  // pass already recorded this row" — a 200 this pass genuinely got, so
  // counting it as `failed` would be as wrong as counting it as a second
  // `delivered`.
  it('counts neither delivered nor failed when a concurrent pass already recorded the row', async () => {
    const deps = buildDeps([row()], transportWith(200));
    deps.markDelivered = () => Promise.resolve(false);

    const result = await sendLogouts(deps, NOW);

    expect(result).toEqual({ delivered: 0, failed: 0 });
  });
});
