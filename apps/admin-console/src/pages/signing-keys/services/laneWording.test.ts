import { describe, expect, it } from 'vitest';
import { LANES, LANE_WORDS } from '#/pages/signing-keys/services/laneWording';

describe('lanes', () => {
  it('are the three stored statuses, in the order a key moves through them', () => {
    expect(LANES.map((lane) => lane.status)).toEqual(['rotating', 'active', 'retired']);
  });

  it('say what each is in a sentence', () => {
    for (const lane of LANES) {
      expect(lane.rule.length).toBeGreaterThan(20);
      expect(lane.empty.length).toBeGreaterThan(10);
    }
  });

  it('name each lane for a list, a skeleton, a failure and an empty state', () => {
    expect(LANE_WORDS.map((lane) => lane.label)).toEqual([
      'Rotating keys',
      'Active keys',
      'Retired keys',
    ]);
    expect(LANE_WORDS[0]).toMatchObject({
      noun: 'rotating keys',
      loading: 'Loading rotating keys',
      failed: 'Rotating keys could not be loaded',
      nothing: 'No rotating keys',
    });
  });
});
