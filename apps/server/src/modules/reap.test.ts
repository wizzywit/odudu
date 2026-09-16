import { type DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { REAP_JITTER_FRACTION, reapModule, reapSchedule } from '#/modules/reap';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://odudu:odudu@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 3).toString('base64'),
};

const APP_URL = { ODUDU_APP_DATABASE_URL: 'postgres://odudu_svc:svc@localhost:5432/odudu' };

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
  it('waits for migrations, so a pass cannot run against a half-built schema', () => {
    const handle = {} as unknown as DatabaseHandle;

    expect(reapModule({ database: handle, ownerDatabase: handle }).dependsOn).toEqual(['database']);
  });
});
