import { expect, it } from 'vitest';
import { administratorOf, freshCreation } from '#/entities/creation-draft';
import { unfinishedOf } from '#/pages/tenants/services/unfinishedCreation';

it('drops a creation only when a subject was already made', () => {
  expect(unfinishedOf(freshCreation('tenant'))).toBeNull();
  expect(unfinishedOf(administratorOf('acme', 'existing'))).toBeNull();
  expect(
    unfinishedOf({
      step: 'administrator',
      tenant: 'acme',
      origin: 'existing',
      username: 'ada',
      email: '',
      subjectId: 's1',
      granted: true,
      holdings: ['tenant-admin'],
    }),
  ).toEqual({ tenant: 'acme', username: 'ada', granted: true });
  expect(unfinishedOf({ step: 'done', tenant: 'acme', username: 'ada' })).toBeNull();
});
