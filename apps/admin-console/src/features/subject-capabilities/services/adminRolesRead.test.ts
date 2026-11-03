import { describe, expect, it } from 'vitest';
import {
  adminRolesBlocked,
  rolesFailure,
} from '#/features/subject-capabilities/services/adminRolesRead';

describe('reading the admin roles', () => {
  it('says why nothing can be saved until the admin roles are read', () => {
    expect(adminRolesBlocked('loading', 'x')).toBe('The admin roles are still being read.');
    expect(adminRolesBlocked('failed', 'x')).toBe(
      'The admin roles could not be read, so nothing can be saved.',
    );
    expect(adminRolesBlocked('ready', 'x')).toBe('x');
    expect(adminRolesBlocked('ready', undefined)).toBeUndefined();
  });
});

describe('rolesFailure', () => {
  it('offers a retry only for admin roles that failed to read', () => {
    const retry = (): void => undefined;
    expect(rolesFailure({ status: 'failed', refused: false, retry })).toEqual({ retry });
    expect(rolesFailure({ status: 'loading' })).toBeNull();
    expect(rolesFailure({ status: 'ready', data: 1 })).toBeNull();
  });
});
