import { expect, it } from 'vitest';
import { currentTime } from '#/shared/api/adapter/clock';

it('reads the clock each time it is asked', () => {
  const before = Date.now();
  const read = currentTime().getTime();
  expect(read).toBeGreaterThanOrEqual(before);
  expect(read).toBeLessThanOrEqual(Date.now());
});
