import { describe, expect, it } from 'vitest';
import {
  claimFields,
  verificationFields,
  PROFILE_SECTIONS,
  ADDRESS_CLAIMS,
  DETAIL_CLAIMS,
  NAME_CLAIMS,
} from '#/features/subjects/service/claims.ts';

describe('the claims', () => {
  it('names every claim the profile carries exactly once', () => {
    const names = [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS].map((claim) => claim.id);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(20);
  });

  it('gives each claim the input its shape needs, and its autocomplete token', () => {
    const inputs = Object.fromEntries(
      [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS].map((c) => [
        c.id,
        `${c.input}:${c.autoComplete ?? '-'}`,
      ]),
    );
    expect(inputs).toEqual({
      name: 'text:name',
      given_name: 'text:given-name',
      family_name: 'text:family-name',
      middle_name: 'text:additional-name',
      nickname: 'text:nickname',
      preferred_username: 'text:username',
      phone_number: 'phone:-',
      profile: 'url:url',
      picture: 'picture:photo',
      website: 'url:url',
      gender: 'gender:-',
      birthdate: 'birthdate:-',
      zoneinfo: 'zone:-',
      locale: 'locale:-',
      address_formatted: 'text:-',
      address_street: 'text:street-address',
      address_locality: 'text:address-level2',
      address_region: 'text:address-level1',
      address_postal_code: 'text:postal-code',
      address_country: 'country:-',
    });
  });

  it('runs a compound field and the address lines wider than one column', () => {
    const spans = Object.fromEntries(
      [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS]
        .filter((c) => c.span !== undefined)
        .map((c) => [c.id, c.span]),
    );
    expect(spans).toEqual({
      phone_number: 'wide',
      address_formatted: 'full',
      address_street: 'wide',
    });
  });

  // Three columns of three rows with no hole: phone and gender, the three
  // web addresses, then birthdate, zone and locale.
  it('orders the details so each row of three columns fills', () => {
    expect(DETAIL_CLAIMS.map((c) => c.id)).toEqual([
      'phone_number',
      'gender',
      'profile',
      'website',
      'picture',
      'birthdate',
      'zoneinfo',
      'locale',
    ]);
  });
});

describe('profile sections', () => {
  it('splits the claims into name, details and address', () => {
    expect(PROFILE_SECTIONS.map((section) => [section.id, section.title])).toEqual([
      ['name', 'Name'],
      ['details', 'Details'],
      ['address', 'Address'],
    ]);
  });

  it('holds each claim as text, the ones the subject lacks as empty', () => {
    const fields = claimFields({ name: 'Ada' } as never, NAME_CLAIMS.slice(0, 2));
    expect(fields).toEqual({
      name: { value: 'Ada', label: 'Full name', kind: 'plain' },
      given_name: { value: '', label: 'Given name', kind: 'plain' },
    });
  });
});

describe('the verification flags', () => {
  it('holds both, labelled, and says verified or not verified for each', () => {
    const fields = verificationFields({
      email_verified: true,
      phone_number_verified: false,
    });
    expect(fields.email_verified).toMatchObject({ value: true, label: 'Email verified' });
    expect(fields.phone_number_verified).toMatchObject({
      value: false,
      label: 'Phone number verified',
    });
    expect(fields.email_verified.describe?.(true)).toBe('verified');
    expect(fields.phone_number_verified.describe?.(false)).toBe('not verified');
  });
});
