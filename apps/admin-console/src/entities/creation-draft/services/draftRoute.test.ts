import { expect, it } from 'vitest';
import { administratorStepHref } from '#/entities/creation-draft/services/draftRoute';

it("puts each tenant's administrator step under its record", () => {
  expect(administratorStepHref('acme')).toBe('/console/system/tenants/acme/new-administrator');
  expect(administratorStepHref('system')).toBe('/console/system/system-admins/new');
});
