import { expect, it } from 'vitest';
import { doneStepOf } from '#/features/tenants/services/done';

it('says what the new administrator was given, and where to go next', () => {
  expect(
    doneStepOf(
      { step: 'done', tenant: 'acme', username: 'grace', holdings: ['view-audit'] },
      'tenant',
    ),
  ).toMatchObject({
    step: 'done',
    tenant: 'acme',
    username: 'grace',
    again: 'tenant',
    systemAdminsHref: null,
    recordHref: '/console/system/tenants/acme',
    enterHref: '/console/acme',
  });
});

it('says a system administrator holds system, and offers the way back to them', () => {
  const done = doneStepOf(
    { step: 'done', tenant: 'system', username: 'root' },
    'system-administrator',
  );
  expect(done.again).toBe('administrator');
  expect(done.systemAdminsHref).not.toBeNull();
});
