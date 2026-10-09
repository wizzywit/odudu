import { describe, expect, it } from 'vitest';
import type { Authority } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/service/result.ts';
import {
  auditView,
  gate,
  overviewAsks,
  readCapability,
  readOutcome,
  type Read,
} from '#/features/overview/service/reads.ts';

const retry = (): void => undefined;

const LOADING: Read<never> = { status: 'loading' };

const FAILED: Read<never> = { status: 'failed', refused: false, retry };

const REFUSED: Read<never> = { status: 'failed', refused: true, retry };

function ready<T>(data: T): Read<T> {
  return { status: 'ready', data };
}

function authority(...capabilities: Authority['capabilities'][number][]): Authority {
  return { capabilities, crossTenant: false };
}

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

describe('a read as a gateway answer reads', () => {
  const answered = (data: number): GatewayResult<number> => ({
    ok: true,
    status: 200,
    data,
    etag: null,
    next: null,
  });

  it('is off when it was not asked, however it was answered', () => {
    expect(readOutcome(false, answered(1), retry)).toEqual({ status: 'off' });
  });

  it('is loading until it answers', () => {
    expect(readOutcome(true, undefined, retry)).toEqual({ status: 'loading' });
  });

  it('is ready with the data', () => {
    expect(readOutcome(true, answered(7), retry)).toEqual({ status: 'ready', data: 7 });
  });

  it('is failed, refused only for a 403, with the way to ask again', () => {
    const problem = (status: number): GatewayResult<number> => ({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Problem', status },
    });
    expect(readOutcome(true, problem(403), retry)).toEqual({
      status: 'failed',
      refused: true,
      retry,
    });
    expect(readOutcome(true, problem(500), retry)).toMatchObject({ refused: false });
    expect(readOutcome(true, { ok: false, kind: 'network' }, retry)).toMatchObject({
      status: 'failed',
      refused: false,
    });
  });
});

describe('which reads the overview asks for', () => {
  it('asks for nothing until whoami has answered, and for the public documents once the tenant is known', () => {
    expect(overviewAsks(undefined, undefined)).toEqual({
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
    expect(overviewAsks(undefined, false).discovery).toBe(true);
    expect(overviewAsks(undefined, true).discovery).toBe(false);
  });

  it('asks for what the held capabilities read', () => {
    expect(overviewAsks(authority('view-users', 'manage-keys'), false)).toMatchObject({
      subjects: true,
      keys: true,
      clients: false,
      settings: false,
      audit: false,
    });
    expect(
      overviewAsks(authority('manage-tenant', 'view-audit', 'manage-clients'), false),
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
    expect(readCapability('discovery')).toBeNull();
    expect(readCapability('jwks')).toBeNull();
    expect(readCapability('audit')).toBe('view-audit');
    expect(readCapability('smtp')).toBe('manage-tenant');
  });
});

describe('the latest activity', () => {
  const events = ready([]);

  it('is left off the page when the audit trail is not the caller to read', () => {
    expect(auditView({ kind: 'refused' }, events, authority())).toBeNull();
  });

  it('is gated by view-audit otherwise', () => {
    expect(auditView({ kind: 'open' }, events, authority('view-audit'))).toBe(events);
    expect(auditView({ kind: 'checking' }, events, undefined)).toBe(events);
  });
});
