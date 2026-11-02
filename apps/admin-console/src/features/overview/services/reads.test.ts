import { describe, expect, it } from 'vitest';
import type { GatewayResult } from '#/shared/services/result';
import {
  auditView,
  gate,
  overviewAsks,
  readCapability,
  mapOverviewRead,
  overviewOutcome,
  type OverviewRead,
} from '#/features/overview/services/reads';
import {
  retry,
  LOADING,
  FAILED,
  REFUSED,
  ready,
  authority,
  areaOf,
} from '#/testing/overviewFixtures';

describe('a read gated by a capability', () => {
  const read = ready(1);

  it('is the read itself when it needs none', () => {
    expect(gate(read, undefined, null)).toBe(read);
  });

  it('is the read while whoami has not answered', () => {
    expect(gate(read, undefined, 'view-audit')).toBe(read);
    expect(gate(LOADING, undefined, 'view-audit')).toBe(LOADING);
  });

  it('names the capability when whoami says it is not held', () => {
    expect(gate(read, authority('view-users'), 'view-audit')).toEqual({
      status: 'needs',
      capability: 'view-audit',
    });
  });

  it('names it too when the server refused the read', () => {
    expect(gate(REFUSED, authority('view-audit'), 'view-audit')).toEqual({
      status: 'needs',
      capability: 'view-audit',
    });
    expect(gate(FAILED, authority('view-audit'), 'view-audit')).toBe(FAILED);
  });
});

describe('a read as a gateway answer reads, for the overview', () => {
  const answered = (data: number): GatewayResult<number> => ({
    ok: true,
    status: 200,
    data,
    etag: null,
    next: null,
  });

  it('is off when it was not asked, however it was answered', () => {
    expect(overviewOutcome(false, answered(1), retry)).toEqual({ status: 'off' });
  });

  it('is what the read says once it was asked', () => {
    expect(overviewOutcome(true, undefined, retry)).toEqual({ status: 'loading' });
    expect(overviewOutcome(true, answered(7), retry)).toEqual({ status: 'ready', data: 7 });
  });

  it('maps what is ready and passes every other state through', () => {
    expect(mapOverviewRead(ready(2), (n) => n * 2)).toEqual({ status: 'ready', data: 4 });
    const off: OverviewRead<number> = { status: 'off' };
    expect(mapOverviewRead<number, number>(off, (n) => n * 2)).toBe(off);
    expect(mapOverviewRead(FAILED, (n: number) => n * 2)).toBe(FAILED);
  });
});

describe('which reads the overview asks for', () => {
  it('asks for nothing until whoami has answered, and for the public documents once the tenant is known', () => {
    expect(overviewAsks(undefined, undefined, areaOf)).toEqual({
      discovery: false,
      subjects: false,
      clients: false,
      groups: false,
      roles: false,
      scopes: false,
      settings: false,
      smtp: false,
      keys: false,
      audit: false,
    });
    expect(overviewAsks(undefined, false, areaOf).discovery).toBe(true);
    expect(overviewAsks(undefined, true, areaOf).discovery).toBe(false);
  });

  it('asks for what the held capabilities read', () => {
    expect(overviewAsks(authority('view-users', 'manage-keys'), false, areaOf)).toMatchObject({
      subjects: true,
      keys: true,
      clients: false,
      settings: false,
      audit: false,
    });
    expect(
      overviewAsks(authority('manage-tenant', 'view-audit', 'manage-clients'), false, areaOf),
    ).toMatchObject({
      groups: true,
      roles: true,
      scopes: true,
      settings: true,
      smtp: true,
      audit: true,
      clients: true,
      subjects: false,
    });
  });

  it('names the capability a read needs, none for the public documents', () => {
    expect(readCapability('discovery', areaOf)).toBeNull();
    expect(readCapability('jwks', areaOf)).toBeNull();
    expect(readCapability('audit', areaOf)).toBe('view-audit');
    expect(readCapability('smtp', areaOf)).toBe('manage-tenant');
  });
});

describe('the latest activity', () => {
  const events = ready([]);

  it('is left off the page when the audit trail is not the caller to read', () => {
    expect(auditView({ kind: 'refused' }, events, authority(), areaOf)).toBeNull();
  });

  it('is gated by view-audit otherwise', () => {
    expect(auditView({ kind: 'open' }, events, authority('view-audit'), areaOf)).toBe(events);
    expect(auditView({ kind: 'checking' }, events, undefined, areaOf)).toBe(events);
  });
});
