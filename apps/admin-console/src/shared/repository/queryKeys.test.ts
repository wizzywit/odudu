import { expect, it } from 'vitest';
import {
  copyEtagKey,
  copyKey,
  countKey,
  deliveriesKey,
  evaluateKey,
  exportKey,
  findKey,
  GROUP_KIND,
  groupKey,
  RECORD_KIND,
  heldCapabilitiesKey,
  holdersKey,
  installationKey,
  listKey,
  membershipsKey,
  overviewKey,
  pageKey,
  pickerKey,
  recordKey,
  systemIssuerKey,
  usernamePolicyKey,
  authorityKey,
} from '#/shared/repository/queryKeys';

it('names every kind of cached read by its kind, its tenant and what it reads', () => {
  expect(listKey('acme', 'roles')).toEqual(['list', 'acme', 'roles']);
  expect(listKey('acme', 'groups', 'children', 'g1')).toEqual([
    'list',
    'acme',
    'groups',
    'children',
    'g1',
  ]);
  expect(countKey('acme', 'roles', 'name=a')).toEqual(['count', 'acme', 'roles', 'name=a']);
  expect(pickerKey('acme', 'roles')).toEqual(['picker', 'acme', 'roles']);
  expect(recordKey('acme', 'clients/c1')).toEqual(['record', 'acme', 'clients/c1']);
  expect(holdersKey('acme', 'enabled', 'any')).toEqual(['holders', 'acme', 'enabled', 'any']);
  expect(heldCapabilitiesKey('acme', 's1')).toEqual(['held-capabilities', 'acme', 's1']);
  expect(overviewKey('acme', 'keys')).toEqual(['overview', 'acme', 'keys']);
  expect(membershipsKey('acme', 's1')).toEqual(['memberships', 'acme', 's1']);
  expect(groupKey('acme', 'g1')).toEqual(['group', 'acme', 'g1']);
  expect(evaluateKey('acme', 'c1', 'a', 'b', 2)).toEqual(['evaluate', 'acme', 'c1', 'a', 'b', 2]);
  expect(deliveriesKey('acme', 'c1')).toEqual(['deliveries', 'acme', 'c1']);
  expect(copyKey('acme', 'r1')).toEqual(['copy', 'acme', 'r1']);
  expect(copyKey('acme', 'scopes', null)).toEqual(['copy', 'acme', 'scopes', null]);
  expect(systemIssuerKey()).toEqual(['system-issuer']);
  expect(installationKey('acme', 'c1')).toEqual(['installation', 'acme', 'c1']);
  expect(usernamePolicyKey('acme')).toEqual(['username-policy', 'acme']);
  expect(authorityKey('acme', 's1')).toEqual(['authority', 'acme', 's1']);
  expect(authorityKey('acme', null)).toEqual(['authority', 'acme', null]);
  expect(findKey('acme', 'roles', 'ops')).toEqual(['find', 'acme', 'roles', 'ops']);
  expect(findKey('tenants', 'acme')).toEqual(['find', 'tenants', 'acme']);
  expect(copyEtagKey('acme', 's1', 'mappers')).toEqual(['copy-etag', 'acme', 's1', 'mappers']);
  expect(exportKey('acme', true)).toEqual(['export', 'acme', true]);
  expect(GROUP_KIND).toBe('group');
  expect(RECORD_KIND).toBe('record');
});

it('is a prefix of what it names when given no more than the tenant', () => {
  expect(listKey('acme')).toEqual(['list', 'acme']);
  expect(countKey('acme')).toEqual(['count', 'acme']);
  expect(holdersKey('acme')).toEqual(['holders', 'acme']);
  expect(heldCapabilitiesKey('acme')).toEqual(['held-capabilities', 'acme']);
  expect(overviewKey('acme')).toEqual(['overview', 'acme']);
});

it('names a page of a list by its query and the cursor it starts from, none being empty', () => {
  const key = listKey('acme', 'roles');
  expect(pageKey(key, new URLSearchParams('name=a'), 'c1')).toEqual([...key, 'name=a', 'c1']);
  expect(pageKey(key, new URLSearchParams('name=a'), undefined)).toEqual([...key, 'name=a', '']);
});
