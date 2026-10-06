import { expect, it } from 'vitest';
import {
  canChange,
  clientReach,
  reachLine,
  type HeldRead,
} from '#/features/clients/service/ceiling.ts';

const SERVICE = { service_subject_id: '00000000-0000-4000-8000-000000000001' };
const retry = (): void => undefined;

function holding(...names: string[]): HeldRead {
  return {
    status: 'ready',
    data: {
      items: names.map((name) => ({
        id: `r-${name}`,
        name,
        client_id: 'c-admin',
        client_key: 'odudu-admin',
        via: [{ kind: 'direct' as const }],
      })),
    },
  };
}

it('judges nothing until the client, the caller and what the service account holds are known', () => {
  expect(clientReach(undefined, holding(), ['manage-clients'])).toEqual({ status: 'checking' });
  expect(clientReach(SERVICE, { status: 'loading' }, ['manage-clients'])).toEqual({
    status: 'checking',
  });
  expect(clientReach(SERVICE, holding(), undefined)).toEqual({ status: 'checking' });
});

it('has nothing to judge for a client with no service account, even before it is asked', () => {
  expect(clientReach({ service_subject_id: null }, { status: 'loading' }, undefined)).toEqual({
    status: 'free',
  });
});

it('names the capabilities the service account holds and the caller does not', () => {
  const reach = clientReach(SERVICE, holding('manage-users', 'view-users'), [
    'manage-clients',
    'view-users',
  ]);
  expect(reach).toEqual({ status: 'ready', beyond: ['manage-users'] });
  expect(clientReach(SERVICE, holding('view-users'), ['view-users'])).toEqual({
    status: 'ready',
    beyond: [],
  });
});

it('keeps a failed read, and whether it was refused, for the page to say', () => {
  const refused = { status: 'failed' as const, refused: true, retry };
  expect(clientReach(SERVICE, refused, ['manage-clients'])).toEqual({
    status: 'unreadable',
    refused: true,
    retry,
  });
});

it('offers a write only where the ceiling has been judged and holds nothing back', () => {
  expect(canChange({ status: 'free' }, [])).toBe(true);
  expect(canChange({ status: 'ready', beyond: [] }, [])).toBe(true);
  expect(canChange({ status: 'ready', beyond: ['manage-users'] }, [])).toBe(false);
  expect(canChange({ status: 'checking' }, [])).toBe(false);
  expect(canChange({ status: 'unreadable', refused: true, retry }, [])).toBe(false);
  expect(canChange({ status: 'free' }, ['manage-clients'])).toBe(false);
});

it('says in one line why a client cannot be changed, and nothing while it is checking', () => {
  expect(reachLine({ status: 'checking' }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'free' }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'ready', beyond: [] }, 'Billing')).toBeNull();
  expect(reachLine({ status: 'ready', beyond: ['manage-users', 'view-users'] }, 'Billing')).toBe(
    "Billing's service account holds manage-users and view-users, which you do not, so you cannot change Billing.",
  );
  expect(reachLine({ status: 'unreadable', refused: true, retry }, 'Billing')).toBe(
    "What Billing's service account holds decides whether you may change it, and reading that needs view-users, which you do not hold. Nothing here can be changed.",
  );
  expect(reachLine({ status: 'unreadable', refused: false, retry }, 'Billing')).toBe(
    "What Billing's service account holds could not be read, so nothing here can be changed until it is.",
  );
});
