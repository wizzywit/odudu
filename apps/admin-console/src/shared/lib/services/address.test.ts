import { describe, expect, it } from 'vitest';
import {
  pageFrame,
  recordAddress,
  resourceAddress,
  tenantPage,
  withSearch,
} from '#/shared/lib/services/address';

describe('addresses', () => {
  it('addresses a tenant, its name encoded', () => {
    expect(tenantPage('acme')).toBe('/console/acme');
    expect(tenantPage('a b')).toBe('/console/a%20b');
  });

  it('addresses a resource list, its creation page and a record, each tenant and id encoded', () => {
    const address = resourceAddress({ segment: 'things', group: 'Stuff', label: 'Things' });
    expect(address.listHref('acme')).toBe('/console/acme/things');
    expect(address.newHref('a b')).toBe('/console/a%20b/things/new');
    expect(address.recordHref('acme', 'c/1')).toBe('/console/acme/things/c%2F1');
  });

  it('trails from the rail group, which is no page, through the list to the record', () => {
    const address = resourceAddress({ segment: 'things', group: 'Stuff', label: 'Things' });
    expect(address.trail('acme', 'One')).toEqual([
      { label: 'Stuff' },
      { label: 'Things', href: '/console/acme/things' },
      { label: 'One' },
    ]);
  });

  it('addresses a record under its list, the id encoded', () => {
    expect(recordAddress('/console/system/tenants', 'a b/c')).toBe(
      '/console/system/tenants/a%20b%2Fc',
    );
  });

  it('adds query parameters to an address, leaving out one left undefined', () => {
    expect(withSearch('/console/acme/roles', { client: 'c 1' })).toBe(
      '/console/acme/roles?client=c+1',
    );
    expect(withSearch('/console/acme/roles', { client: 'a b+c' })).toBe(
      '/console/acme/roles?client=a+b%2Bc',
    );
    expect(withSearch('/console/acme/groups/new', { parent: undefined })).toBe(
      '/console/acme/groups/new',
    );
  });
});

it('frames a page by its title and the trail that ends at it', () => {
  const trail = (tenant: string, current: string) => [
    { label: tenant, href: '/' },
    { label: current },
  ];
  expect(pageFrame(trail, 'acme', 'Client')).toEqual({
    title: 'Client',
    breadcrumb: [{ label: 'acme', href: '/' }, { label: 'Client' }],
  });
});
