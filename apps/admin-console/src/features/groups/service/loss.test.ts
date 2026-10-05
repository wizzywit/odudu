import { describe, expect, it } from 'vitest';
import { lossOf, selfLoss } from '#/features/groups/service/loss.ts';
import { lossText, possibleLoss } from '#/features/groups/service/address.ts';

describe('what a write here takes from yourself', () => {
  const via = (path: string) => ({
    kind: 'group' as const,
    group_id: `g${path}`,
    group_path: path,
  });
  const held = (name: string, ...paths: string[]) => ({
    id: `r-${name}`,
    name,
    client_id: 'c',
    client_key: 'odudu-admin',
    via: paths.map(via),
  });

  it('takes from a delete only what reaches you through groups inside it', () => {
    const roles = [held('manage-users', '/eng'), held('view-audit', '/eng/platform')];
    expect(
      selfLoss({ roles, groups: ['/eng/platform'] }, { kind: 'delete', path: '/eng/platform' }),
    ).toEqual(['manage-users', 'view-audit']);
    // A member of /eng itself keeps what /eng maps when /eng/platform goes.
    expect(
      selfLoss({ roles, groups: ['/eng'] }, { kind: 'delete', path: '/eng/platform' }),
    ).toEqual([]);
  });

  it('takes from a move what the groups above handed down, unless the new parent is under them', () => {
    const roles = [held('manage-keys', '/top')];
    const groups = ['/top/mid'];
    expect(selfLoss({ roles, groups }, { kind: 'move', path: '/top/mid', to: '/other' })).toEqual([
      'manage-keys',
    ]);
    expect(
      selfLoss({ roles, groups }, { kind: 'move', path: '/top/mid', to: '/top/elsewhere' }),
    ).toEqual([]);
    expect(
      selfLoss(
        { roles, groups: ['/top/mid', '/top'] },
        { kind: 'move', path: '/top/mid', to: null },
      ),
    ).toEqual([]);
  });

  it('takes the roles taken off a group, as mapped there', () => {
    const roles = [held('manage-users', '/eng'), held('view-audit', '/eng')];
    expect(
      selfLoss(
        { roles, groups: ['/eng'] },
        { kind: 'roles', path: '/eng', removed: ['r-manage-users'] },
      ),
    ).toEqual(['manage-users']);
  });

  it('asks without your own groups by what you hold that the write would take', () => {
    expect(possibleLoss(['view-audit', 'manage-keys'], ['manage-keys', 'view-users'])).toEqual([
      'manage-keys',
    ]);
  });
});

describe('the loss a write is asked about', () => {
  const roles = [
    {
      id: 'r-view-audit',
      name: 'view-audit',
      client_id: 'c',
      client_key: 'odudu-admin',
      via: [{ kind: 'group' as const, group_id: 'g', group_path: '/eng' }],
    },
  ];
  const change = { kind: 'delete' as const, path: '/eng' };

  it('waits while the principal’s own access is read', () => {
    expect(lossOf({ status: 'loading' }, [], change, [])).toEqual({ kind: 'checking' });
  });

  it('is certain from the principal’s own access, and possible from whoami alone', () => {
    const certain = lossOf({ status: 'ready', roles, groups: ['/eng'] }, [], change, []);
    expect(certain).toEqual({ kind: 'certain', lost: ['view-audit'] });
    expect(lossText(certain, 'these groups')).toBe(
      ' You hold view-audit through these groups, so this takes it from you, and this console with it.',
    );
    const possible = lossOf({ status: 'unknown' }, ['view-audit'], change, ['view-audit']);
    expect(lossText(possible, 'these groups')).toBe(
      ' If you hold view-audit through these groups, this takes it from you, and this console with it.',
    );
    expect(lossOf({ status: 'unknown' }, ['view-audit'], change, [])).toEqual({ kind: 'none' });
  });
});
