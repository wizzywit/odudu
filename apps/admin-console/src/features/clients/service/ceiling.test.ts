import { expect, it } from 'vitest';
import { canChange, clientReach, reachLine } from '#/features/clients/service/ceiling.ts';

const SERVICE: NonNullable<Parameters<typeof clientReach>[0]> = {
  service_subject_id: '00000000-0000-4000-8000-000000000001',
  service_account_admin_reach: ['view-users', 'manage-users'],
};

it('judges nothing until the client and the caller are known', () => {
  expect(clientReach(undefined, ['manage-clients'])).toEqual({ status: 'checking' });
  expect(clientReach(SERVICE, undefined)).toEqual({ status: 'checking' });
});

it('has nothing to judge for a client with no service account, even before the caller is known', () => {
  expect(
    clientReach({ service_subject_id: null, service_account_admin_reach: [] }, undefined),
  ).toEqual({ status: 'free' });
});

it('names what the service account holds that the caller does not, from the record alone', () => {
  expect(clientReach(SERVICE, ['manage-clients', 'view-users'])).toEqual({
    status: 'ready',
    beyond: ['manage-users'],
  });
  expect(clientReach(SERVICE, ['manage-clients', 'view-users', 'manage-users'])).toEqual({
    status: 'ready',
    beyond: [],
  });
  expect(clientReach({ ...SERVICE, service_account_admin_reach: [] }, ['manage-clients'])).toEqual({
    status: 'ready',
    beyond: [],
  });
});

it('offers a write only where the ceiling has been judged and holds nothing back', () => {
  expect(canChange({ status: 'free' }, [])).toBe(true);
  expect(canChange({ status: 'ready', beyond: [] }, [])).toBe(true);
  expect(canChange({ status: 'ready', beyond: ['manage-users'] }, [])).toBe(false);
  expect(canChange({ status: 'checking' }, [])).toBe(false);
  expect(canChange({ status: 'free' }, ['manage-clients'])).toBe(false);
});

it('says in one line why a client cannot be changed, and nothing while it is unknown', () => {
  expect(reachLine({ status: 'checking' }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'free' }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'ready', beyond: [] }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'ready', beyond: ['manage-users'] }, undefined)).toBeNull();
  expect(reachLine({ status: 'ready', beyond: ['manage-users', 'view-users'] }, 'Billing')).toBe(
    "Billing's service account holds manage-users and view-users, which you do not, so you cannot change Billing.",
  );
});
