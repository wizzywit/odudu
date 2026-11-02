import { describe, expect, it } from 'vitest';
import {
  clearConsequence,
  clearFailure,
  clearedText,
  clearMoreText,
  lockoutClearState,
} from '#/features/settings/services/lockouts';
import type { GatewayFailure } from '#/shared/services/result';

const refused = (status: number): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Forbidden', status },
});

describe('when the clear is on offer', () => {
  it('waits for whoami, offers the clear to a holder of manage-users and says what a lack needs', () => {
    expect(lockoutClearState(undefined)).toBe('checking');
    expect(lockoutClearState({ capabilities: ['manage-users'], crossTenant: false })).toBe('ready');
    expect(lockoutClearState({ capabilities: ['manage-tenant'], crossTenant: false })).toBe(
      'lacking',
    );
  });
});

describe('what clearing every lockout says it does', () => {
  const text = clearConsequence('acme');

  it('names the tenant and says both kinds of failed attempt are reset at once', () => {
    expect(text).toContain('every lockout in acme');
    expect(text).toContain('wrong password and every wrong second factor');
    expect(text).toContain('try again at once');
  });

  it('says whose count is kept, how many go per request and that the clear is audited', () => {
    expect(text).toContain('admin capability you do not hold');
    expect(text).toContain('10,000');
    expect(text).toContain('audit trail');
  });
});

describe('what a clear came to', () => {
  const cleared = (n: number, remaining = 0, beyond = 0) =>
    clearedText('acme', { cleared: n, remaining, beyond_ceiling: beyond });

  it('counts the accounts whose failed attempts were cleared', () => {
    expect(cleared(1)).toBe('Cleared the failed sign-ins of 1 account in acme.');
    expect(cleared(3)).toBe('Cleared the failed sign-ins of 3 accounts in acme.');
    expect(cleared(0)).toBe('Nobody in acme had failed sign-ins to clear.');
  });

  it('says to clear again while more are left within reach', () => {
    expect(cleared(10000, 40)).toBe(
      'Cleared the failed sign-ins of 10000 accounts in acme. More are left: clear every lockout again to clear the next 10,000.',
    );
  });

  it('says how many were kept for a capability the caller lacks', () => {
    expect(cleared(2, 0, 1)).toBe(
      'Cleared the failed sign-ins of 2 accounts in acme. 1 was kept: its subject holds an admin capability you do not hold.',
    );
    expect(cleared(0, 0, 3)).toBe(
      'No failed sign-ins in acme were cleared. 3 were kept: their subjects hold an admin capability you do not hold.',
    );
  });
});

describe('when the clear fails', () => {
  it('words a refusal naming the capability, a lost answer and a console fault', () => {
    expect(clearFailure('acme', refused(403))).toContain('manage-users');
    expect(clearFailure('acme', { ok: false, kind: 'network' })).toContain(
      'has not been sent again',
    );
    expect(clearFailure('acme', { ok: false, kind: 'defect' })).toContain('was not done');
  });
});

describe('what stays beside the action while lockouts remain', () => {
  it('says to clear again only while more are left, and is none otherwise', () => {
    expect(clearMoreText('acme', { cleared: 10000, remaining: 40, beyond_ceiling: 0 })).toBe(
      'More failed sign-ins are left in acme: clear every lockout again to clear the next 10,000.',
    );
    expect(clearMoreText('acme', { cleared: 3, remaining: 0, beyond_ceiling: 1 })).toBeNull();
  });
});
