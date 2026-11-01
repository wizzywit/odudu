import { expect, it } from 'vitest';
import { isNarrow, NARROW_REM } from '#/shared/service/narrow';

it('is narrow under 48rem and not at it, whatever the rem is', () => {
  expect(NARROW_REM).toBe(48);
  expect(isNarrow(767, 16)).toBe(true);
  expect(isNarrow(768, 16)).toBe(false);
  expect(isNarrow(900, 20)).toBe(true);
  expect(isNarrow(0, 16)).toBe(true);
  expect(isNarrow(500, 0)).toBe(false);
});
