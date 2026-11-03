import { describe, expect, it } from 'vitest';
import { HAND_OVER_MS, TIMING } from '@site/src/features/landing/services/timing';

describe('the scene timing', () => {
  it('settles only after the slowest caption has risen', () => {
    expect(HAND_OVER_MS).toBeGreaterThan(TIMING.riseAfterTimedMs + TIMING.riseMs);
    expect(HAND_OVER_MS).toBeGreaterThan(TIMING.riseAfterClickMs + TIMING.riseMs);
  });

  it('shows a clicked caption before the old one has gone', () => {
    expect(TIMING.riseAfterClickMs).toBeLessThanOrEqual(120);
    expect(TIMING.riseAfterClickMs).toBeLessThan(TIMING.leaveMs);
  });
});
