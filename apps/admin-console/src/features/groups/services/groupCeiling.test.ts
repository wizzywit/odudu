import { describe, expect, it } from 'vitest';
import { createUnderHref } from '#/features/groups/services/groupCreation';
import {
  groupCeiling,
  groupReadiness,
  namedGroupRead,
  ceilingLines,
  ceilingParentReach,
} from '#/features/groups/services/groupCeiling';
import { group } from '#/testing/groupAnswers';
import { reach } from '#/testing/roleAnswers';

describe('what a write waits for', () => {
  it('fails once the ceiling failed, and checks until it and the loss are known', () => {
    const none = { kind: 'none' } as const;
    expect(groupReadiness('failed', none)).toBe('failed');
    expect(groupReadiness('checking', none)).toBe('checking');
    expect(groupReadiness('ready', { kind: 'checking' })).toBe('checking');
    expect(groupReadiness('ready', none)).toBe('ready');
    expect(groupReadiness('ready', { kind: 'certain', lost: ['view-audit'] })).toBe('ready');
  });
});

describe('the ceiling of a group record', () => {
  const record = {
    ...group('g-eng', '/eng'),
    admin_reach: reach('view-audit'),
    subtree_admin_reach: reach(),
    holds_default_group: false,
  };
  const authority = { capabilities: reach('view-audit', 'manage-users'), crossTenant: false };
  const retry = (): void => undefined;
  it('fails with the parent read, and checks until all three are known', () => {
    expect(groupCeiling({ status: 'failed', retry }, authority, record)).toEqual({
      status: 'failed',
      retry,
    });
    expect(groupCeiling({ status: 'loading' }, authority, record)).toEqual({ status: 'checking' });
    expect(groupCeiling({ status: 'none' }, undefined, record)).toEqual({ status: 'checking' });
    expect(groupCeiling({ status: 'none' }, authority, undefined)).toEqual({ status: 'checking' });
  });
  it('takes the parent reach from the parent read, none at the top level', () => {
    const top = groupCeiling({ status: 'none' }, authority, record);
    expect(top).toMatchObject({ status: 'ready', parentReach: [], caller: authority.capabilities });
    const parent = { ...record, id: 'g-p', admin_reach: reach('manage-users') };
    expect(groupCeiling({ status: 'ready', data: parent }, authority, record)).toMatchObject({
      status: 'ready',
      parentReach: ['manage-users'],
    });
  });
  it('offers a group under this one only to a caller holding all it hands out', () => {
    const ready = groupCeiling({ status: 'none' }, authority, record);
    expect(createUnderHref('acme', record, ready)).toBe('/console/acme/groups/new?parent=g-eng');
    const narrow = groupCeiling(
      { status: 'none' },
      { ...authority, capabilities: reach('manage-users') },
      record,
    );
    expect(createUnderHref('acme', record, narrow)).toBeNull();
    expect(createUnderHref('acme', undefined, ready)).toBeNull();
    expect(createUnderHref('acme', record, { status: 'checking' })).toBeNull();
  });
});

describe('reading a ceiling', () => {
  const authority = { capabilities: reach('manage-users'), crossTenant: false };
  const record = {
    ...group('g-eng', '/eng'),
    admin_reach: reach(),
    subtree_admin_reach: reach('view-users'),
    holds_default_group: false,
  };
  const ready = groupCeiling({ status: 'none' }, authority, record);
  it('gives the caller, the parent reach and the lines once ready, and nothing before', () => {
    expect(ceilingParentReach(ready)).toEqual([]);
    expect(ceilingLines(ready).remove).toContain('view-users');
    expect(ceilingParentReach({ status: 'checking' })).toEqual([]);
    expect(ceilingLines({ status: 'checking' })).toEqual({ move: null, remove: null });
  });
});

describe('a group named by an id', () => {
  it('is none for none, and what was read for an id', () => {
    const read = { status: 'loading' } as const;
    expect(namedGroupRead(null, read)).toEqual({ status: 'none' });
    expect(namedGroupRead('g-eng', read)).toBe(read);
  });
});
