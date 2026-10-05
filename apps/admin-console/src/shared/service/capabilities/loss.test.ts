import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { ADMIN_CLIENT_KEY } from '#/shared/service/capabilities/holdings.ts';
import { asksFirst, lossBlocked, adminLoss } from '#/shared/service/capabilities/loss.ts';

function role(
  name: string,
  via: EffectiveRoleAssignment['via'],
  clientKey: string | null = ADMIN_CLIENT_KEY,
): EffectiveRoleAssignment {
  return {
    id: `r-${name}`,
    name,
    client_id: clientKey === null ? null : 'c-admin',
    client_key: clientKey,
    via,
  };
}

describe('adminLoss', () => {
  const group = (path: string) => ({
    kind: 'group' as const,
    group_id: `g${path}`,
    group_path: path,
  });
  const within = (parent: string) => ({
    kind: 'composite' as const,
    parent_role_id: `r-${parent}`,
    parent_name: parent,
  });

  it('names what goes once every way it is held goes, nested capabilities with it', () => {
    const own = [
      role('tenant-admin', [group('/admins')]),
      role('manage-users', [within('tenant-admin')]),
      role('view-users', [within('manage-users'), { kind: 'direct' }]),
      role('auditor', [group('/admins')], null),
    ];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual([
      'tenant-admin',
      'manage-users',
    ]);
  });

  it('keeps what is held another way too', () => {
    const own = [role('view-audit', [group('/admins'), group('/ops')])];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual(
      [],
    );
  });
});

describe('asksFirst and lossBlocked', () => {
  it('asks before a loss that is certain or possible, and waits while it is checked', () => {
    expect(asksFirst({ kind: 'certain', lost: ['a'] })).toBe(true);
    expect(asksFirst({ kind: 'possible', lost: ['a'] })).toBe(true);
    expect(asksFirst({ kind: 'none' })).toBe(false);
    expect(asksFirst({ kind: 'checking' })).toBe(false);
    expect(lossBlocked({ kind: 'checking' })).toBe('Checking what this takes from you first.');
    expect(lossBlocked({ kind: 'none' })).toBeUndefined();
    expect(lossBlocked({ kind: 'certain', lost: ['a'] })).toBeUndefined();
  });
});
