import { describe, expect, it } from 'vitest';
import { qualifiedRoleName } from '#/service/role-name';

describe('qualifiedRoleName', () => {
  it('leaves a realm role bare', () => {
    expect(qualifiedRoleName({ name: 'admin' }, null)).toBe('admin');
  });

  it('qualifies a client role with the owning client', () => {
    expect(qualifiedRoleName({ name: 'reader' }, 'reports-api')).toBe('reports-api:reader');
  });
});
