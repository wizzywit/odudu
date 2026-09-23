import { type DatabaseHandle } from '@odudu/db';
import { type LogoutDeliveryTransport } from '@odudu/protocol-oidc';
import { FakeClock, loadConfig, type Logger, type ModuleContext } from '@odudu/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type LogoutSenderDeps,
  type LogoutSenderOptions,
  type LogoutSenderReport,
} from '#/cli/send-logouts';
import {
  LOGOUT_SENDER_JITTER_FRACTION,
  logoutSenderModule,
  logoutSenderSchedule,
  type LogoutSenderPass,
} from '#/modules/logout-sender';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://odudu:odudu@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 3).toString('base64'),
};

const APP_URL = { ODUDU_APP_DATABASE_URL: 'postgres://odudu_svc:svc@localhost:5432/odudu' };

const NOW = new Date('2026-06-01T12:00:00.000Z');
const INTERVAL_MS = 15_000;
const ONE_TICK_MS = INTERVAL_MS * (1 + LOGOUT_SENDER_JITTER_FRACTION);

const handle = {} as unknown as DatabaseHandle;
const transport: LogoutDeliveryTransport = () => Promise.resolve({ status: 200 });
const DEPS = { database: handle, ownerDatabase: handle, transport };

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
  readonly deps: LogoutSenderDeps;
  readonly now: Date;
  readonly options: LogoutSenderOptions;
}

function recordingPass(outcome: LogoutSenderReport): {
  pass: LogoutSenderPass;
  calls: readonly Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    pass: (deps, now, options) => {
      calls.push({ deps, now, options });
      return Promise.resolve(outcome);
    },
  };
}

const DELIVERED: LogoutSenderReport = { ran: true, delivered: 2, failed: 1 };

describe('whether the server delivers back-channel logouts on its own schedule', () => {
  it('schedules on the configured interval with a jittered tail', () => {
    const decision = logoutSenderSchedule(loadConfig({ ...MINIMAL, ...APP_URL }));

    expect(decision).toEqual({
      scheduled: true,
      intervalMs: INTERVAL_MS,
      jitterMs: INTERVAL_MS * LOGOUT_SENDER_JITTER_FRACTION,
    });
  });

  it('declines when the schedule is switched off', () => {
    const decision = logoutSenderSchedule(
      loadConfig({ ...MINIMAL, ...APP_URL, ODUDU_LOGOUT_SENDER_ENABLED: 'false' }),
    );

    expect(decision).toEqual({ scheduled: false, why: 'switched-off' });
  });

  it('declines rather than scheduling a pass that can only refuse', () => {
    const decision = logoutSenderSchedule(loadConfig(MINIMAL));

    expect(decision).toEqual({ scheduled: false, why: 'no-serving-connection' });
  });
});

describe('logoutSenderModule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for migrations, so a pass cannot run against a half-built schema', () => {
    expect(logoutSenderModule(DEPS).dependsOn).toEqual(['database']);
  });

  it('gives the pass the clock and the options the context carries', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(DELIVERED);
    const ctx = context({ ...APP_URL, ODUDU_LOGOUT_SENDER_BATCH_SIZE: '7' }, log.logger);
    const module = logoutSenderModule(DEPS, pass);

    await module.start?.(ctx);
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.deps.database).toBe(handle);
    expect(calls[0]?.deps.transport).toBe(transport);
    // The context's clock, not the wall clock a timer fired against.
    expect(calls[0]?.now).toEqual(NOW);
    expect(calls[0]?.options.batchSize).toBe(7);

    await module.stop?.();
  });

  it('reports what a pass delivered and what it could not', async () => {
    const log = recorder();
    const module = logoutSenderModule(DEPS, recordingPass(DELIVERED).pass);

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    await module.stop?.();

    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { delivered: 2, failed: 1 },
      message: 'logout delivery pass complete',
    });
  });

  // Every few seconds, forever: a line per tick would bury everything else
  // in the log. A pass that found nothing due says nothing.
  it('says nothing about a pass with nothing due', async () => {
    const log = recorder();
    const module = logoutSenderModule(
      DEPS,
      recordingPass({ ran: true, delivered: 0, failed: 0 }).pass,
    );

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 3);
    await module.stop?.();

    expect(log.lines.map((line) => line.message)).not.toContain('logout delivery pass complete');
  });

  it('reports a skipped pass as skipped rather than as a pass that delivered nothing', async () => {
    const log = recorder();
    const skipped: LogoutSenderReport = { ran: false, reason: 'no tenant was enumerated' };
    const module = logoutSenderModule(DEPS, recordingPass(skipped).pass);

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    await module.stop?.();

    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { reason: skipped.reason },
      message: 'logout delivery pass skipped',
    });
  });

  // The property a background loop lives or dies by: what is asserted is
  // the two *later* passes, which only happen if the loop rescheduled
  // itself after the throw — not that the failure was logged.
  it('keeps delivering after a pass throws', async () => {
    const log = recorder();
    let passes = 0;
    const module = logoutSenderModule(DEPS, () => {
      passes += 1;
      return passes === 1
        ? Promise.reject(new Error('a relying party exploded'))
        : Promise.resolve(DELIVERED);
    });

    await module.start?.(context(APP_URL, log.logger));
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    expect(passes).toBe(1);

    await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 2);
    expect(passes).toBe(3);

    await module.stop?.();
  });

  it('starts no timer and delivers nothing when the schedule is switched off', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(DELIVERED);
    const module = logoutSenderModule(DEPS, pass);

    await module.start?.(context({ ...APP_URL, ODUDU_LOGOUT_SENDER_ENABLED: 'false' }, log.logger));

    expect(vi.getTimerCount()).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe('info');
    expect(log.lines[0]?.message).toContain('ODUDU_LOGOUT_SENDER_ENABLED=false');

    await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 4);
    expect(calls).toHaveLength(0);

    await expect(module.stop?.()).resolves.toBeUndefined();
  });

  // One line, at boot, naming both halves of the way out: the variable
  // that would let the pass run, and the switch that says the schedule
  // lives somewhere else.
  it('warns once, naming the variable and the switch, with no serving connection', async () => {
    const log = recorder();
    const { pass, calls } = recordingPass(DELIVERED);
    const module = logoutSenderModule(DEPS, pass);

    await module.start?.(context({}, log.logger));

    expect(vi.getTimerCount()).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe('warn');
    expect(log.lines[0]?.message).toContain('ODUDU_APP_DATABASE_URL');
    expect(log.lines[0]?.message).toContain('ODUDU_LOGOUT_SENDER_ENABLED=false');

    await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 4);
    expect(calls).toHaveLength(0);

    await expect(module.stop?.()).resolves.toBeUndefined();
  });
});
