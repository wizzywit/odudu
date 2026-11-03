import { expect, it } from 'vitest';
import { againOf } from '#/features/tenants/services/creationOutcome';

it('starts over to a tenant from a tenant, and to an administrator from any other flow', () => {
  expect(againOf('tenant')).toBe('tenant');
  expect(againOf('system-administrator')).toBe('administrator');
  expect(againOf('administrator/acme')).toBe('administrator');
});
