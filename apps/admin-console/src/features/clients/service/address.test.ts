import { expect, it } from 'vitest';
import {
  clientHref,
  clientsHref,
  clientsTrail,
  newClientHref,
} from '#/features/clients/service/address.ts';

it('addresses the list, the creation page and a record, each tenant and id encoded', () => {
  expect(clientsHref('acme')).toBe('/console/acme/clients');
  expect(newClientHref('a b')).toBe('/console/a%20b/clients/new');
  expect(clientHref('acme', 'c/1')).toBe('/console/acme/clients/c%2F1');
});

it('trails from the rail group, which is no page, through the list to the record', () => {
  expect(clientsTrail('acme', 'Billing')).toEqual([
    { label: 'Applications' },
    { label: 'Clients', href: '/console/acme/clients' },
    { label: 'Billing' },
  ]);
});
