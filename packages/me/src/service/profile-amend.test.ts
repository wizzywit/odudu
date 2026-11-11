import type { UserRecord } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import { planProfileAmend } from '#/service/profile-amend';

const CURRENT = {
  subjectId: 'subject-1',
  username: 'ada',
  email: 'ada@example.com',
  name: 'Ada',
  givenName: 'Ada',
  nickname: null,
  birthdate: '1990-01-31',
  phoneNumber: '+2348012345678',
  phoneNumberVerified: true,
} as UserRecord;

describe('planProfileAmend', () => {
  it('writes what changed, by column key, and names the fields', () => {
    expect(planProfileAmend(CURRENT, { name: 'Ada L', nickname: 'ada' })).toEqual({
      kind: 'change',
      profile: { name: 'Ada L', nickname: 'ada' },
      verification: null,
      fields: ['name', 'nickname'],
    });
  });

  it('writes nothing for a value the profile already holds', () => {
    expect(planProfileAmend(CURRENT, { name: 'Ada', nickname: null })).toEqual({
      kind: 'unchanged',
    });
  });

  it('clears a claim given null', () => {
    expect(planProfileAmend(CURRENT, { given_name: null })).toMatchObject({
      kind: 'change',
      profile: { givenName: null },
    });
  });

  it('drops the verification of a phone number that changes', () => {
    expect(planProfileAmend(CURRENT, { phone_number: '+2348099999999' })).toEqual({
      kind: 'change',
      profile: { phoneNumber: '+2348099999999' },
      verification: { phoneNumberVerified: false },
      fields: ['phone_number'],
    });
  });

  it('leaves the verification of a number it does not change', () => {
    expect(planProfileAmend(CURRENT, { phone_number: '+2348012345678', name: 'B' })).toMatchObject({
      verification: null,
      fields: ['name'],
    });
  });

  it('has no verification to drop on a number that was never verified', () => {
    const unverified = { ...CURRENT, phoneNumberVerified: false } as UserRecord;
    expect(planProfileAmend(unverified, { phone_number: 'anything' })).toMatchObject({
      verification: null,
    });
  });

  it.each([
    ['birthdate', '31/01/1990'],
    ['zoneinfo', '+1'],
    ['locale', 'not a locale'],
    ['website', 'ftp://example.com'],
  ])('refuses %s %s for its shape, naming the field', (field, value) => {
    const plan = planProfileAmend(CURRENT, { [field]: value });
    expect(plan).toMatchObject({ kind: 'invalid_value', field });
  });

  it('refuses a bidirectional control in a name it would add, not one already held', () => {
    expect(planProfileAmend(CURRENT, { name: 'Ad‮a' })).toMatchObject({
      kind: 'invalid_value',
      field: 'name',
    });
    const held = { ...CURRENT, name: 'Ad‮a' } as UserRecord;
    expect(planProfileAmend(held, { name: 'Ad‮a', nickname: 'x' })).toMatchObject({
      kind: 'change',
      fields: ['nickname'],
    });
  });
});
