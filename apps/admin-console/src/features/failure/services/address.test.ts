import { expect, it } from 'vitest';
import { overviewAddress } from '#/features/failure/services/address';

it('goes to the overview of the tenant in the address', () => {
  expect(overviewAddress('acme')).toBe('/console/acme');
});

it('goes to the console root where there is no tenant, or no tenant by that name', () => {
  expect(overviewAddress(undefined)).toBe('/console/');
  expect(overviewAddress('Not A Tenant!')).toBe('/console/');
});
