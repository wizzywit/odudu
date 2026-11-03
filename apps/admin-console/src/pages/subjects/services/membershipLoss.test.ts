import { describe, expect, it } from 'vitest';
import {
  groupsRemoveTenants,
  groupsSaveConfirmation,
  leaveConfirmation,
  takesTenants,
} from '#/pages/subjects/services/membershipLoss';

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

  it('takes manage-tenants itself held by a group, but never a lesser holding', () => {
    const group = [{ kind: 'group', group_id: 'g', group_path: '/admins' }];
    expect(takesTenants([{ ...full(group), name: 'manage-tenants' }], ['/admins'], [])).toBe(true);
    expect(takesTenants([{ ...full(group), name: 'view-audit' }], ['/admins'], [])).toBe(false);
  });
});

describe('leaving groups', () => {
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
});
