import { describe, expect, it } from 'vitest';
import {
  groupPathOf,
  groupsRemoveTenants,
  groupsSaveConfirmation,
  leaveConfirmation,
  leftGroups,
  membershipsOf,
  takesTenants,
} from '#/features/subjects/services/memberships';

describe('whether leaving groups takes manage-tenants', () => {
  const full = (via: unknown[]) => ({
    id: 'r-full',
    name: 'tenant-admin',
    client_id: 'c',
    client_key: 'odudu-admin',
    via: via as never,
  });
  const byGroup = full([{ kind: 'group', group_id: 'g', group_path: '/admins' }]);

  it('does when the last group beneath the mapped one is left', () => {
    expect(takesTenants([byGroup], ['/admins/oncall'], [])).toBe(true);
  });

  it('does not while another group beneath it remains, or Full is held otherwise', () => {
    expect(takesTenants([byGroup], ['/admins/oncall', '/admins'], ['/admins'])).toBe(false);
    expect(
      takesTenants(
        [full([{ kind: 'direct' }, { kind: 'group', group_id: 'g', group_path: '/admins' }])],
        ['/admins'],
        [],
      ),
    ).toBe(false);
    expect(takesTenants([byGroup], ['/ops'], [])).toBe(false);
  });
});

describe('group memberships', () => {
  const known = new Map([['g1', { path: '/a', description: 'A' }]]);

  it('names each by its path and description, or by its id until it is known', () => {
    expect(membershipsOf(['g1', 'g2'], known)).toEqual([
      { id: 'g1', path: '/a', description: 'A' },
      { id: 'g2', path: 'g2', description: null },
    ]);
  });

  it('lists the paths of the groups that were held and are no longer chosen', () => {
    const held = [
      { id: 'g1', path: '/a' },
      { id: 'g2', path: '/b' },
    ];
    expect(leftGroups(held, ['g2'])).toEqual(['/a']);
    expect(leftGroups(held, ['g1', 'g2'])).toEqual([]);
  });

  it('asks before you leave groups of your own, and nobody else', () => {
    expect(leaveConfirmation(false, ['/a'])).toBeNull();
    expect(leaveConfirmation(true, [])).toBeNull();
    expect(leaveConfirmation(true, ['/a', '/b'])).toMatchObject({
      title: 'Leave groups of your own?',
      typed: null,
      consequence: expect.stringMatching(
        /^You are leaving \/a, \/b\. Every role a group carries/u,
      ) as string,
    });
  });

  it('takes manage-tenants only in system, once the roles are read', () => {
    const effective = {
      status: 'ready',
      retry: () => undefined,
      data: {
        items: [
          {
            id: 'r',
            name: 'tenant-admin',
            client_id: 'c',
            client_key: 'odudu-admin',
            via: [{ kind: 'group', group_id: 'g', group_path: '/admins' }],
          },
        ],
      },
    } as never;
    expect(groupsRemoveTenants('system', effective, ['/admins'], [])).toBe(true);
    expect(groupsRemoveTenants('acme', effective, ['/admins'], [])).toBe(false);
    expect(groupsRemoveTenants('system', { status: 'loading' }, ['/admins'], [])).toBe(false);
  });
});

describe('what saving the groups of a subject asks first', () => {
  const asked = { name: 'ada', self: false, removesTenants: false, left: [] as string[] };

  it('asks nothing of a plain save', () => {
    expect(groupsSaveConfirmation(asked)).toBeNull();
    expect(groupsSaveConfirmation({ ...asked, left: ['/eng'] })).toBeNull();
  });
  it('asks before leaving groups of your own', () => {
    expect(groupsSaveConfirmation({ ...asked, self: true, left: ['/eng'] })?.title).toBe(
      'Leave groups of your own?',
    );
  });
  it('asks before taking system administration, which comes before the leaving of a group', () => {
    const confirmation = groupsSaveConfirmation({ ...asked, removesTenants: true, left: ['/eng'] });
    expect(confirmation?.title).toBe('Take system administration from ada?');
    expect(confirmation?.typed).toBe('ada');
    expect(
      groupsSaveConfirmation({ ...asked, self: true, removesTenants: true, left: ['/eng'] })?.title,
    ).toBe('Revoke your own system administration?');
  });
  it('names a group by its path once known, and by its id before', () => {
    const known = new Map([['g1', { path: '/eng' }]]);
    expect(groupPathOf(known, 'g1')).toBe('/eng');
    expect(groupPathOf(known, 'g2')).toBe('g2');
  });
});
