import { describe, expect, it } from 'vitest';
import { systemRecordHref } from '#/features/shell/services/railGroups';

describe('the way back to system', () => {
  it('is the tenant’s record under System › Tenants, where it was entered', () => {
    expect(systemRecordHref('acme')).toBe('/console/system/tenants/acme');
    expect(systemRecordHref('a b')).toBe('/console/system/tenants/a%20b');
  });
});
