import { describe, expect, it } from 'vitest';
import {
  lossAction,
  lossBlocked,
  adminLoss,
  removalConfirmation,
} from '#/shared/services/capabilities/loss';
import { effectiveRole } from '#/testing/roleAnswers';

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
      effectiveRole('tenant-admin', [group('/admins')]),
      effectiveRole('manage-users', [within('tenant-admin')]),
      effectiveRole('view-users', [within('manage-users'), { kind: 'direct' }]),
      effectiveRole('auditor', [group('/admins')], null),
    ];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual([
      'tenant-admin',
      'manage-users',
    ]);
  });

  it('keeps what is held another way too', () => {
    const own = [effectiveRole('view-audit', [group('/admins'), group('/ops')])];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual(
      [],
    );
  });
});

describe('lossAction and lossBlocked', () => {
  it('waits while a loss is checked, asks when it is certain or possible, else runs', () => {
    expect(lossAction({ kind: 'checking' })).toBe('wait');
    expect(lossAction({ kind: 'none' })).toBe('run');
    expect(lossAction({ kind: 'certain', lost: ['a'] })).toBe('ask');
    expect(lossAction({ kind: 'possible', lost: ['a'] })).toBe('ask');
    expect(lossBlocked({ kind: 'checking' })).toBe('Checking what this takes from you first.');
    expect(lossBlocked({ kind: 'none' })).toBeUndefined();
    expect(lossBlocked({ kind: 'certain', lost: ['a'] })).toBeUndefined();
  });
});

describe('what is asked before a save takes capabilities away', () => {
  it('asks nothing of a change to somebody else that leaves every tenant alone', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: false,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toBeNull();
    expect(
      removalConfirmation({ name: 'ada', self: true, removed: [], removesTenants: false }),
    ).toBeNull();
  });

  it('says what this console stops offering when you take from yourself', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toEqual({
      title: 'Remove your own admin capabilities?',
      consequence:
        'You are taking view-audit from yourself. Once it lands this console stops offering reading the audit trail, unless a group or another role still gives it to you, and you cannot give it back yourself.',
      typed: null,
    });
  });

  it('asks for the name, typed, before manage-tenants is taken from anybody', () => {
    const asked = removalConfirmation({
      name: 'ada',
      self: false,
      removed: ['tenant-admin'],
      removesTenants: true,
    });
    expect(asked?.title).toBe('Take system administration from ada?');
    expect(asked?.typed).toBe('ada');
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['manage-tenants'],
        removesTenants: true,
      })?.title,
    ).toBe('Revoke your own system administration?');
  });
});
