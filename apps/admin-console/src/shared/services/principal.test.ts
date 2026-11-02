import { expect, it } from 'vitest';
import { isOwnTenant, isSelf } from '#/shared/services/principal';

const ME = { tenant: 'system', subjectId: 's1', username: 'ada' };

it('is oneself only in the same tenant and with the same subject id', () => {
  expect(isSelf(ME, 'system', 's1')).toBe(true);
  expect(isSelf(ME, 'acme', 's1')).toBe(false);
  expect(isSelf(ME, 'system', 's2')).toBe(false);
});

it('is in its own tenant only where the session was issued', () => {
  expect(isOwnTenant(ME, 'system')).toBe(true);
  expect(isOwnTenant(ME, 'acme')).toBe(false);
});
