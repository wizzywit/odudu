import { type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { roleSelfLoss } from '#/pages/roles/services/roleLoss';

describe('what a role write takes from yourself', () => {
  const own: EffectiveRoleAssignment[] = [
    { id: 'r-aud', name: 'auditor', client_id: null, client_key: null, via: [{ kind: 'direct' }] },
    {
      id: 'r-users',
      name: 'manage-users',
      client_id: 'c',
      client_key: 'odudu-admin',
      via: [{ kind: 'composite', parent_role_id: 'r-aud', parent_name: 'auditor' }],
    },
  ];
  it('counts what is held only through a deleted role, or an edge taken out', () => {
    expect(roleSelfLoss(own, { kind: 'delete', id: 'r-aud' })).toEqual(['manage-users']);
    expect(roleSelfLoss(own, { kind: 'remove', id: 'r-aud', child: 'r-users' })).toEqual([
      'manage-users',
    ]);
    expect(roleSelfLoss(own, { kind: 'remove', id: 'r-other', child: 'r-users' })).toEqual([]);
  });
});
