import { describe, expect, it } from 'vitest';
import { areaHref, overviewHref } from '#/entities/area/services/areaHref';
import { areaAt, OVERVIEW } from '#/entities/area/services/areas';

describe('where an area lives', () => {
  it('links the overview at the tenant itself', () => {
    expect(areaHref('acme', OVERVIEW)).toBe('/console/acme');
    expect(areaHref('system', OVERVIEW)).toBe('/console/system');
  });

  it.each([
    ['registration-tokens', '/console/a%20b/registration-tokens'],
    ['sessions', '/console/a%20b/sessions'],
    ['tenants', '/console/a%20b/tenants'],
  ] as const)('%s is under the tenant, its name encoded', (path, href) => {
    expect(areaHref('a b', areaAt(path))).toBe(href);
  });
});

describe('where the overview is', () => {
  it('goes to the overview of the tenant in the address', () => {
    expect(overviewHref('acme')).toBe('/console/acme');
  });

  it('goes to the console root where there is no tenant, or no tenant by that name', () => {
    expect(overviewHref(undefined)).toBe('/console/');
    expect(overviewHref('Not A Tenant!')).toBe('/console/');
  });
});
