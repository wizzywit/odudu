import { type DatabaseHandle } from '@odudu/db';
import { FakeClock, loadConfig, type Logger, type ModuleContext } from '@odudu/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  retentionPolicyFromConfig,
  type ReapDeps,
  type ReapOutcome,
  type RetentionPolicy,
} from '#/cli/reap';
import { REAP_JITTER_FRACTION, reapModule, reapSchedule, type ReapPass } from '#/modules/reap';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://odudu:odudu@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 3).toString('base64'),
};

const APP_URL = { ODUDU_APP_DATABASE_URL: 'postgres://odudu_svc:svc@localhost:5432/odudu' };

const NOW = new Date('2026-06-01T12:00:00.000Z');

const handle = {} as unknown as DatabaseHandle;
const DEPS = { database: handle, ownerDatabase: handle };

interface Line {
  readonly level: 'info' | 'warn' | 'error';
  readonly payload: object;
  readonly message: string | undefined;
}

interface Recorder {
  readonly logger: Logger;
  readonly lines: readonly Line[];
}

function recorder(): Recorder {
  const lines: Line[] = [];
  const record =
    (level: Line['level']) =>
    (payload: object, message?: string): void => {
      lines.push({ level, payload, message });
    };
  const logger: Logger = {
    debug: () => undefined,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  };
  return { logger, lines };
}

function context(env: Record<string, string>, logger: Logger): ModuleContext {
  return { config: loadConfig({ ...MINIMAL, ...env }), clock: new FakeClock(NOW), logger };
}

interface Call {
  readonly deps: ReapDeps;
  readonly now: Date;
  readonly policy: RetentionPolicy;
}

function recordingPass(outcome: ReapOutcome): { pass: ReapPass; calls: readonly Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    pass: (deps, now, policy) => {
      calls.push({ deps, now, policy });
      return Promise.resolve(outcome);
    },
  };
}

const SWEPT: ReapOutcome = {
  ran: true,
  deleted: {
    refresh_tokens: 2,
    authorization_codes: 1,
    token_grants: 1,
    authentication_sessions: 0,
    action_tokens: 0,
    client_registration_tokens: 0,
    login_failures: 0,
    email_outbox: 0,
    backchannel_logout_deliveries: 0,
    client_assertion_jti: 0,
    sessions: 1,
    audit_events: 0,
  },
};

describe('whether the server reaps on its own schedule', () => {
  it('schedules hourly with a jittered tail when a serving connection is configured', () => {
    const decision = reapSchedule(loadConfig({ ...MINIMAL, ...APP_URL }));

    expect(decision).toEqual({
      scheduled: true,
      intervalMs: 3_600_000,
      jitterMs: 3_600_000 * REAP_JITTER_FRACTION,
    });
  });

  it('declines when the schedule is switched off', () => {
    const decision = reapSchedule(
      loadConfig({ ...MINIMAL, ...APP_URL, ODUDU_REAP_ENABLED: 'false' }),
    );

    expect(decision).toEqual({ scheduled: false, why: 'switched-off' });
  });

  // `reap` refuses without ODUDU_APP_DATABASE_URL in every environment,
  // while the boot guard demands it only in production. Decided here, once,
  // rather than rediscovered by a pass that throws every hour forever.
  it('declines rather than scheduling a pass that can only refuse', () => {
    const decision = reapSchedule(loadConfig(MINIMAL));

    expect(decision).toEqual({ scheduled: false, why: 'no-serving-connection' });
  });
});

describe('reapModule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for migrations, so a pass cannot run against a half-built schema', () => {
    expect(reapModule(DEPS).dependsOn).toEqual(['database']);
  });

  it('gives the pass the clock and the windows the context carries', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(SWEPT);
    const ctx = context({ ...APP_URL, ODUDU_RETENTION_SESSION_SECONDS: '600' }, log.logger);
    const module = reapModule(DEPS, pass);

    await module.start?.(ctx);
    await vi.advanceTimersByTimeAsync(3_600_000 * (1 + REAP_JITTER_FRACTION));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.deps).toBe(DEPS);
    // The context's clock, not the wall clock a timer fired against.
    expect(calls[0]?.now).toEqual(NOW);
    expect(calls[0]?.policy).toEqual(retentionPolicyFromConfig(ctx.config));
    expect(calls[0]?.policy.sessionSeconds).toBe(600);

    await module.stop?.();
  });

  it('reports the rows a pass deleted', async () => {
    const log = recorder();
    const module = reapModule(DEPS, recordingPass(SWEPT).pass);

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(3_600_000 * (1 + REAP_JITTER_FRACTION));
    await module.stop?.();

    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { deleted: SWEPT.deleted },
      message: 'retention pass complete',
    });
  });

  // A skipped pass and a pass that deleted nothing are different facts, and
  // the pass already distinguishes them; the schedule must not flatten them
  // back into one by logging a report either way.
  it('reports a skipped pass as skipped rather than as a sweep of zeros', async () => {
    const log = recorder();
    const skipped: ReapOutcome = {
      ran: false,
      reason: 'another instance holds the retention lock',
    };
    const module = reapModule(DEPS, recordingPass(skipped).pass);

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(3_600_000 * (1 + REAP_JITTER_FRACTION));
    await module.stop?.();

    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { reason: skipped.reason },
      message: 'retention pass skipped',
    });
    expect(log.lines.map((line) => line.message)).not.toContain('retention pass complete');
  });

  it('starts no timer and runs nothing when the schedule is switched off', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(SWEPT);
    const module = reapModule(DEPS, pass);

    await module.start?.(context({ ...APP_URL, ODUDU_REAP_ENABLED: 'false' }, log.logger));

    expect(vi.getTimerCount()).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe('info');
    expect(log.lines[0]?.message).toContain('ODUDU_REAP_ENABLED=false');

    await vi.advanceTimersByTimeAsync(3_600_000 * 4);
    expect(calls).toHaveLength(0);

    // Nothing was started, so nothing must fail on the way down either.
    await expect(module.stop?.()).resolves.toBeUndefined();
  });

  // The warning has to name both halves of the way out: the variable that
  // would let the pass run, and the switch that says the schedule lives
  // somewhere else. One line, at boot, rather than the same refusal thrown
  // on every tick for the life of the process.
  it('warns once, naming the variable and the switch, with no serving connection', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(SWEPT);
    const module = reapModule(DEPS, pass);

    await module.start?.(context({}, log.logger));

    expect(vi.getTimerCount()).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe('warn');
    expect(log.lines[0]?.message).toContain('ODUDU_APP_DATABASE_URL');
    expect(log.lines[0]?.message).toContain('ODUDU_REAP_ENABLED=false');

    await vi.advanceTimersByTimeAsync(3_600_000 * 4);
    expect(calls).toHaveLength(0);

    await expect(module.stop?.()).resolves.toBeUndefined();
  });

  // Production refuses to boot without ODUDU_APP_DATABASE_URL
  // (`assertProductionAppDatabaseUrl`), which runs before any module
  // starts, so the branch above is unreachable there — the schedule that
  // does start in production is always one with a serving connection.
  it('schedules in production, where the boot guard has already demanded the variable', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(SWEPT);
    const module = reapModule(DEPS, pass);

    await module.start?.(context({ ...APP_URL, NODE_ENV: 'production' }, log.logger));
    await vi.advanceTimersByTimeAsync(3_600_000 * (1 + REAP_JITTER_FRACTION));

    expect(calls).toHaveLength(1);

    await module.stop?.();
  });
});
