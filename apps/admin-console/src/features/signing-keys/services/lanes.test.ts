import { describe, expect, it } from 'vitest';
import { LANES } from '#/features/signing-keys/services/lanes';

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
});
