import { describe, expect, it } from 'vitest';
import { auditEvent } from '#/testing/auditFixtures';
import { loadedRange } from '#/features/audit/services/trailCount';

describe('the time range of the rows loaded', () => {
  it('names nothing for no rows', () => {
    expect(loadedRange([], 'UTC')).toBeNull();
  });

  it('runs from the newest row to the oldest, in the zone read, newest first as listed', () => {
    const rows = [
      auditEvent({ id: '1', occurred_at: '2026-09-28T13:41:05Z' }),
      auditEvent({ id: '2', occurred_at: '2026-09-28T13:40:00Z' }),
      auditEvent({ id: '3', occurred_at: '2026-09-27T09:00:00Z' }),
    ];
    expect(loadedRange(rows, 'UTC')).toBe(
      '3 events loaded, from 2026-09-28 13:41:05 UTC (UTC+00:00) back to 2026-09-27 09:00:00 UTC (UTC+00:00).',
    );
  });

  it('says one event as one', () => {
    expect(loadedRange([auditEvent({ occurred_at: '2026-09-28T13:41:05Z' })], 'UTC')).toBe(
      '1 event loaded, at 2026-09-28 13:41:05 UTC (UTC+00:00).',
    );
  });
});
