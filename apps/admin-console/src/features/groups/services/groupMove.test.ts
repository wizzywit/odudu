import { describe, expect, it } from 'vitest';
import {
  moveRefusal,
  moveUnavailable,
  parentUnavailable,
} from '#/features/groups/services/groupMove';
import { group } from '#/testing/groupAnswers';
import { reach } from '#/testing/roleAnswers';

describe('moving a group', () => {
  const eng = group('g-eng', '/eng');
  it('never offers the group itself or anything beneath it as its parent', () => {
    expect(moveUnavailable(eng, eng)).toBe('the group itself');
    expect(moveUnavailable(eng, group('g-p', '/eng/platform'))).toBe(
      'beneath /eng, so the move would make a loop',
    );
    expect(moveUnavailable(eng, group('g-x', '/engineering'))).toBeNull();
  });
  it('says what a refused move means where it was made', () => {
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'would create a group reparent cycle',
      }),
    ).toBe(
      'Refused: the parent chosen sits beneath this group, so the move would make a loop. Nothing was changed.',
    );
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 403,
        detail: 'the caller does not hold: view-users',
      }),
    ).toBe('Refused: it would hand out view-users, which you do not hold yourself.');
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'a group named "ops" already exists there',
      }),
    ).toBe(
      'Refused: the parent chosen already holds a group named "ops", and two groups beside each other cannot share a name. Nothing was changed.',
    );
  });
});

describe('what a group hands out', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    ...group('g-mid', '/top/mid'),
    admin_reach: reach('view-audit'),
    subtree_admin_reach: reach('manage-keys', 'view-audit'),
    holds_default_group: false,
    ...extra,
  });
  it('never offers a parent handing out what the caller lacks', () => {
    const top = { ...group('g-admins', '/admins'), admin_reach: reach('view-users') };
    expect(parentUnavailable(record(), top, ['view-audit'])).toBe(
      'its members receive view-users, which you do not hold',
    );
    expect(parentUnavailable(record(), top, ['view-users'])).toBeNull();
    expect(parentUnavailable(record(), { ...record(), admin_reach: [] }, [])).toBe(
      'the group itself',
    );
  });
  it('holds a group with a default beneath it out of a parent that hands out a capability', () => {
    const top = { ...group('g-admins', '/admins'), admin_reach: reach('view-users') };
    const holder = record({ holds_default_group: true });
    expect(parentUnavailable(holder, top, ['view-users'])).toBe(
      'its members receive view-users, and a group every new subject joins, or holds one beneath it, may reach no admin capability',
    );
    expect(parentUnavailable(holder, { ...top, admin_reach: [] }, [])).toBeNull();
  });
});
