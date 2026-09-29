import { USERNAME_RULE } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  ADDRESS_CLAIMS,
  credentialsOf,
  DETAIL_CLAIMS,
  lockoutSummary,
  NAME_CLAIMS,
  newSubjectHref,
  subjectHref,
  subjectName,
  subjectsHref,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/features/subjects/service.ts';

describe('addresses', () => {
  it('puts a subject under its tenant, each part escaped', () => {
    expect(subjectsHref('acme')).toBe('/console/acme/subjects');
    expect(newSubjectHref('acme')).toBe('/console/acme/subjects/new');
    expect(subjectHref('acme', 'a b')).toBe('/console/acme/subjects/a%20b');
  });
});

describe('the username', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(USERNAME_RULE_TEXT.toLowerCase()).toBe(`${USERNAME_RULE}.`.toLowerCase());
    expect(USERNAME_RULE_TEXT.startsWith('A username')).toBe(true);
  });

  it('asks for one before sending anything', () => {
    expect(usernameProblem('')).toBe('Enter a username.');
    expect(usernameProblem('ada')).toBeNull();
  });

  it('names a subject by its username, or by its kind and id when it has none', () => {
    expect(subjectName({ id: 's1', type: 'user', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', type: 'service', username: null })).toBe('service s2');
  });
});

describe('the claims', () => {
  it('names every claim the profile carries exactly once', () => {
    const names = [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS].map((claim) => claim.id);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(20);
  });
});

describe('credentials', () => {
  it('splits a list into the password, the second factors and the recovery-code count', () => {
    const split = credentialsOf([
      { id: 'p', type: 'password', created_at: '2026-01-01T00:00:00.000Z', expired: false },
      { id: 't', type: 'totp', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'w', type: 'webauthn', created_at: '2026-01-03T00:00:00.000Z' },
      { type: 'recovery-code', created_at: '2026-01-04T00:00:00.000Z', recovery_code_count: 7 },
    ]);
    expect(split.password?.id).toBe('p');
    expect(split.factors.map((factor) => factor.id)).toEqual(['t', 'w']);
    expect(split.recoveryCodes).toBe(7);
  });

  it('holds no password, no factors and no codes for an empty list', () => {
    expect(credentialsOf([])).toEqual({ password: null, factors: [], recoveryCodes: null });
  });
});

describe('the lockout', () => {
  it('says a subject with nothing on record has no failed sign-ins', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 0,
        last_failure_at: null,
      }),
    ).toEqual({ tone: 'neutral', state: 'not locked', text: 'No failed sign-ins on record.' });
  });

  it('says how many failures a subject that is not locked has on record', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 1,
        last_failure_at: '2026-09-29T09:58:00.000Z',
      }),
    ).toMatchObject({ tone: 'neutral', state: 'not locked', text: /^1 failed sign-in on record/u });
  });

  it('says a locked subject is locked, and after how many failures', () => {
    expect(
      lockoutSummary({
        locked: true,
        locked_until: '2026-09-29T10:02:00.000Z',
        failure_count: 6,
        last_failure_at: '2026-09-29T09:59:00.000Z',
      }),
    ).toMatchObject({ tone: 'danger', state: 'locked', text: /after 6 failed sign-ins/u });
  });
});
