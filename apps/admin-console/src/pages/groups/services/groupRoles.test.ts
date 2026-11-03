import { describe, expect, it } from 'vitest';
import { defaultingOf } from '#/pages/groups/services/groupReach';
import { roleUnavailable, keptRoles, reachOfRoles } from '#/pages/groups/services/groupRoles';
import { reach } from '#/testing/roleAnswers';

describe('what a group hands out', () => {
  it('names the default beneath a group as the reason a role cannot be given', () => {
    const bundle = { name: 'bundle', client_key: null, admin_reach: reach('view-users') };
    expect(roleUnavailable(bundle, ['view-users'], 'beneath', 'acme')).toBe(
      'Every new subject joins a group beneath this one and so receives what this one hands out, so it may hand out no admin capability.',
    );
    expect(defaultingOf({ default_for_new_subjects: false, holds_default_group: true })).toBe(
      'beneath',
    );
    expect(defaultingOf({ default_for_new_subjects: true, holds_default_group: true })).toBe(
      'itself',
    );
    expect(
      defaultingOf({ default_for_new_subjects: false, holds_default_group: false }),
    ).toBeNull();
  });
  it('says why a role cannot be given or taken here, however deep it nests a capability', () => {
    const reaching = (name: string, reach: string[], clientKey: string | null = null) => ({
      name,
      client_key: clientKey,
      admin_reach: reach,
    });
    expect(
      roleUnavailable(
        reaching('manage-keys', ['manage-keys'], 'odudu-admin'),
        ['view-users'],
        null,
        'acme',
      ),
    ).toBe('You do not hold manage-keys, so you cannot give or take it.');
    expect(roleUnavailable(reaching('bundle', ['view-audit']), ['view-users'], null, 'acme')).toBe(
      'It reaches view-audit, which you do not hold, so you cannot give or take it.',
    );
    expect(
      roleUnavailable(reaching('bundle', ['view-users']), ['view-users'], 'itself', 'acme'),
    ).toBe('Every new subject joins this group, so it may hand out no admin capability.');
    expect(roleUnavailable(reaching('auditor', []), [], 'itself', 'acme')).toBeNull();
  });
});

describe('the roles of a group', () => {
  const items = [
    {
      id: 'r1',
      name: 'auditor',
      client_id: 'c',
      client_key: 'k',
      description: null,
      admin_reach: reach('view-audit'),
    },
    {
      id: 'r2',
      name: 'plain',
      client_id: null,
      client_key: null,
      description: null,
      admin_reach: reach(),
    },
  ];
  it('keeps the mapped roles the caller could not give', () => {
    expect(keptRoles(items, reach('manage-users'), 'acme')).toEqual(['r1']);
    expect(keptRoles(items, reach('view-audit'), 'acme')).toEqual([]);
  });
  it('adds up what the removed roles hand out', () => {
    expect(reachOfRoles(items, ['r1', 'r2', 'gone'])).toEqual(['view-audit']);
  });
});
