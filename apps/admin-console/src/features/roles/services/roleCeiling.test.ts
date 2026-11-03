import { describe, expect, it } from 'vitest';
import { type AdminCapability } from '#/shared/services/principal';
import {
  compositesOffered,
  defaultsChecking,
  isDeleteHeld,
  roleCeiling,
  deleteChecking,
  removalAction,
} from '#/features/roles/services/roleCeiling';
import { role } from '#/testing/roleAnswers';

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

const FULL = role('r-full', 'tenant-admin', 'odudu-admin', ['view-users', 'manage-users']);

// A tenant role nesting a capability two levels down.
const DEEP = role('r-deep', 'deep', null, ['view-audit']);

describe('the ceiling of a role record', () => {
  const authority = { capabilities: ['view-users'] as AdminCapability[], crossTenant: false };
  it('checks until whoami and the record are read', () => {
    expect(roleCeiling(undefined, authority)).toEqual({ status: 'checking' });
    expect(roleCeiling(READER, undefined)).toEqual({ status: 'checking' });
  });
  it('holds a deletion by what the role reaches, never for the built-in client', () => {
    expect(roleCeiling(READER, authority)).toEqual({
      status: 'ready',
      caller: ['view-users'],
      deleteHeld: null,
    });
    expect(roleCeiling(DEEP, authority)).toMatchObject({
      deleteHeld: 'deep reaches view-audit, which you do not hold, so you cannot delete it.',
    });
    expect(roleCeiling(FULL, authority)).toMatchObject({ deleteHeld: null });
    expect(isDeleteHeld(roleCeiling(DEEP, authority))).toBe(true);
    expect(isDeleteHeld(roleCeiling(READER, authority))).toBe(false);
    expect(isDeleteHeld({ status: 'checking' })).toBe(false);
  });
  it('checks the defaults until read, except for a built-in role that has none to check', () => {
    expect(defaultsChecking(READER, { status: 'checking' })).toBe(true);
    expect(defaultsChecking(USERS, { status: 'checking' })).toBe(false);
    expect(defaultsChecking(READER, roleCeiling(READER, authority))).toBe(false);
  });
});

describe('the composites a role offers', () => {
  it('waits for the ceiling and for the principal own roles', () => {
    const ready = { status: 'ready', caller: [], deleteHeld: null } as const;
    expect(compositesOffered(ready, { status: 'ready' })).toBe(true);
    expect(compositesOffered(ready, { status: 'unknown' })).toBe(true);
    expect(compositesOffered(ready, { status: 'loading' })).toBe(false);
    expect(compositesOffered({ status: 'checking' }, { status: 'ready' })).toBe(false);
  });
});

const certain = { kind: 'certain', lost: ['view-audit'] } as const;

describe('what a removal does first', () => {
  it('waits while the loss is read, asks when it takes from the caller, else runs', () => {
    expect(removalAction({ kind: 'checking' })).toBe('wait');
    expect(removalAction({ kind: 'none' })).toBe('run');
    expect(removalAction(certain)).toBe('ask');
    expect(removalAction({ kind: 'possible', lost: ['view-audit'] })).toBe('ask');
  });
  it('checks a deletion until the ceiling and the loss are known', () => {
    const ready = { status: 'ready', caller: [], deleteHeld: null } as const;
    expect(deleteChecking({ status: 'checking' }, { kind: 'none' })).toBe(true);
    expect(deleteChecking(ready, { kind: 'checking' })).toBe(true);
    expect(deleteChecking(ready, { kind: 'none' })).toBe(false);
    expect(deleteChecking(ready, certain)).toBe(false);
  });
});
