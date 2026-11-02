import { describe, expect, it } from 'vitest';
import { areaHref } from '#/entities/area/services/areaHref';
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
