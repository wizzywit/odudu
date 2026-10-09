import { expect, it } from 'vitest';
import { isSelf } from '#/shared/service/principal.ts';

const ME = { tenant: 'system', subjectId: 's1', username: 'ada' };

it('is oneself only in the same tenant and with the same subject id', () => {
  expect(isSelf(ME, 'system', 's1')).toBe(true);
  expect(isSelf(ME, 'acme', 's1')).toBe(false);
  expect(isSelf(ME, 'system', 's2')).toBe(false);
});
