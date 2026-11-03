import { describe, expect, it } from 'vitest';
import { themeRefusal, writeCapability } from '#/features/branding/services/themeScope';

describe('the capability a scope’s writes need', () => {
  it('is manage-tenant for the tenant and manage-clients for a client', () => {
    expect(writeCapability({ kind: 'tenant' })).toBe('manage-tenant');
    expect(writeCapability({ kind: 'client', id: 'c1' })).toBe('manage-clients');
  });

  it('is the one a refused save names, whose scope it is', () => {
    const forbidden = { type: 'about:blank', title: 'Forbidden', status: 403 };
    expect(themeRefusal({ kind: 'tenant' })(forbidden)).toContain('the manage-tenant capability');
    expect(themeRefusal({ kind: 'client', id: 'c1' })(forbidden)).toContain(
      'the manage-clients capability',
    );
    expect(themeRefusal({ kind: 'tenant' })({ ...forbidden, status: 500 })).toBeNull();
  });
});
