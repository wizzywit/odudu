import { type DatabaseHandle } from '@odudu/db';
import { FakeClock, loadConfig, type Logger, type ModuleContext } from '@odudu/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainRecheckOutcome, type DomainRecheckDeps } from '#/cli/domains';
import {
  DOMAIN_RECHECK_JITTER_FRACTION,
  domainRecheckModule,
  domainRecheckSchedule,
  type DomainRecheckPass,
} from '#/modules/domain-recheck';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://odudu:odudu@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 3).toString('base64'),
};
const READY = {
  ODUDU_APP_DATABASE_URL: 'postgres://odudu_svc:svc@localhost:5432/odudu',
  ODUDU_PUBLIC_BASE_URL: 'https://id.operator.net',
};
const NOW = new Date('2026-11-04T12:00:00.000Z');
const HOUR = 3_600_000;
const WINDOW = HOUR * (1 + DOMAIN_RECHECK_JITTER_FRACTION);

const handle = {} as unknown as DatabaseHandle;
const DEPS = { database: handle, ownerDatabase: handle };

interface Line {
  readonly level: 'info' | 'warn' | 'error';
  readonly payload: object;
  readonly message: string | undefined;
}

function recorder(): { logger: Logger; lines: Line[] } {
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

const SWEPT: DomainRecheckOutcome = {
  ran: true,
  checked: 4,
  failed: 1,
  indeterminate: 0,
  fellBack: 1,
  errored: 0,
};

describe('whether the server rechecks domains on its own schedule', () => {
  it('schedules hourly with a jittered tail when it can serve and write', () => {
    expect(domainRecheckSchedule(loadConfig({ ...MINIMAL, ...READY }))).toEqual({
      scheduled: true,
      intervalMs: HOUR,
      jitterMs: HOUR * DOMAIN_RECHECK_JITTER_FRACTION,
      options: { threshold: 3, base: READY.ODUDU_PUBLIC_BASE_URL, tls: false },
    });
  });

  it('follows the configured interval', () => {
    const decision = domainRecheckSchedule(
      loadConfig({ ...MINIMAL, ...READY, ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS: '120' }),
    );
    expect(decision).toMatchObject({ scheduled: true, intervalMs: 120_000 });
  });

  it('declines when switched off, with no serving connection, or with no base URL', () => {
    const off = loadConfig({ ...MINIMAL, ...READY, ODUDU_DOMAIN_RECHECK_ENABLED: 'false' });
    expect(domainRecheckSchedule(off)).toEqual({ scheduled: false, why: 'switched-off' });
    const noServing = loadConfig({
      ...MINIMAL,
      ODUDU_PUBLIC_BASE_URL: READY.ODUDU_PUBLIC_BASE_URL,
    });
    expect(domainRecheckSchedule(noServing)).toEqual({
      scheduled: false,
      why: 'no-serving-connection',
    });
    const noBase = loadConfig({ ...MINIMAL, ODUDU_APP_DATABASE_URL: READY.ODUDU_APP_DATABASE_URL });
    expect(domainRecheckSchedule(noBase)).toEqual({ scheduled: false, why: 'no-base-url' });
  });
});

describe('domainRecheckModule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for migrations', () => {
    expect(domainRecheckModule(DEPS).dependsOn).toEqual(['database']);
  });

  it('hands the pass the context clock and the threshold and addresses from config', async () => {
    const log = recorder();
    const calls: { deps: DomainRecheckDeps; now: Date; threshold: number; base: string }[] = [];
    const pass: DomainRecheckPass = (deps, now, options) => {
      calls.push({ deps, now, threshold: options.threshold, base: options.base });
      return Promise.resolve(SWEPT);
    };
    const module = domainRecheckModule(DEPS, pass);
    await module.start?.(context({ ...READY, ODUDU_DOMAIN_RECHECK_FAILURES: '5' }, log.logger));
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(calls).toEqual([
      { deps: DEPS, now: NOW, threshold: 5, base: 'https://id.operator.net' },
    ]);
    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { checked: 4, failed: 1, indeterminate: 0, fellBack: 1, errored: 0 },
      message: 'domain recheck complete',
    });
    await module.stop?.();
  });

  it('logs a row the pass could not settle, naming its tenant and host', async () => {
    const log = recorder();
    const module = domainRecheckModule(DEPS, (_deps, _now, options) => {
      options.onRowError?.(
        {
          id: 'd1',
          tenantId: 't1',
          tenantName: 'acme',
          host: 'login.acme.com',
          challenge: 'secret-challenge',
          failedChecks: 0,
          canonical: false,
        },
        new Error('poisoned'),
      );
      return Promise.resolve({ ...SWEPT, errored: 1 });
    });
    await module.start?.(context(READY, log.logger));
    await vi.advanceTimersByTimeAsync(WINDOW);
    await module.stop?.();
    const line = log.lines.find((l) => l.level === 'error');
    expect(line?.payload).toMatchObject({ tenantId: 't1', host: 'login.acme.com' });
    expect(JSON.stringify(line?.payload)).not.toContain('secret-challenge');
  });

  it('reports a skipped pass as skipped', async () => {
    const log = recorder();
    const reason = 'another instance holds the recheck lock';
    const module = domainRecheckModule(DEPS, () => Promise.resolve({ ran: false, reason }));
    await module.start?.(context(READY, log.logger));
    await vi.advanceTimersByTimeAsync(WINDOW);
    await module.stop?.();
    expect(log.lines).toContainEqual({
      level: 'info',
      payload: { reason },
      message: 'domain recheck skipped',
    });
  });

  // "The pass failed" says nothing about whether the loop is still alive; a
  // later run does.
  it('logs a pass that throws and runs again on the next tick', async () => {
    const log = recorder();
    let runs = 0;
    const module = domainRecheckModule(DEPS, () => {
      runs += 1;
      return runs === 1 ? Promise.reject(new Error('database down')) : Promise.resolve(SWEPT);
    });
    await module.start?.(context(READY, log.logger));
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(runs).toBe(1);
    expect(log.lines.some((line) => line.level === 'error')).toBe(true);
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(runs).toBe(2);
    await module.stop?.();
  });

  it('starts no timer when switched off, and says where the schedule lives', async () => {
    const log = recorder();
    const module = domainRecheckModule(DEPS, () => Promise.resolve(SWEPT));
    await module.start?.(context({ ...READY, ODUDU_DOMAIN_RECHECK_ENABLED: 'false' }, log.logger));
    expect(vi.getTimerCount()).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.message).toContain('ODUDU_DOMAIN_RECHECK_ENABLED=false');
    await expect(module.stop?.()).resolves.toBeUndefined();
  });

  it('warns once and starts no timer without a serving connection or a base URL', async () => {
    for (const [env, named] of [
      [{ ODUDU_PUBLIC_BASE_URL: READY.ODUDU_PUBLIC_BASE_URL }, 'ODUDU_APP_DATABASE_URL'],
      [{ ODUDU_APP_DATABASE_URL: READY.ODUDU_APP_DATABASE_URL }, 'ODUDU_PUBLIC_BASE_URL'],
    ] as const) {
      const log = recorder();
      const module = domainRecheckModule(DEPS, () => Promise.resolve(SWEPT));
      await module.start?.(context(env, log.logger));
      expect(vi.getTimerCount()).toBe(0);
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]?.level).toBe('warn');
      expect(log.lines[0]?.message).toContain(named);
    }
  });
});
