import { type Profile } from '@odudu/contracts/admin';
import { flagText } from '#/shared/service/format.ts';
import type { SectionFields } from '#/shared/service/sectionSave';

type Claim = keyof Omit<Profile, 'email_verified' | 'phone_number_verified' | 'profile_updated_at'>;

// Which typed field a claim is edited with, by the shape OIDC Core §5.1
// gives it.
export type ClaimInput =
  'text' | 'url' | 'picture' | 'phone' | 'birthdate' | 'gender' | 'zone' | 'locale' | 'country';

export interface ClaimField {
  id: Claim;
  label: string;
  input: ClaimInput;
  // The HTML token naming what a text claim holds (WCAG 1.3.5); a typed
  // field carries its own.
  autoComplete?: string;
  // How far the field runs across the profile's columns, where one is narrow.
  span?: 'wide' | 'full';
}

export const NAME_CLAIMS: readonly ClaimField[] = [
  { id: 'name', label: 'Full name', input: 'text', autoComplete: 'name' },
  { id: 'given_name', label: 'Given name', input: 'text', autoComplete: 'given-name' },
  { id: 'family_name', label: 'Family name', input: 'text', autoComplete: 'family-name' },
  { id: 'middle_name', label: 'Middle name', input: 'text', autoComplete: 'additional-name' },
  { id: 'nickname', label: 'Nickname', input: 'text', autoComplete: 'nickname' },
  {
    id: 'preferred_username',
    label: 'Preferred username',
    input: 'text',
    autoComplete: 'username',
  },
];

export const DETAIL_CLAIMS: readonly ClaimField[] = [
  { id: 'phone_number', label: 'Phone number', input: 'phone', span: 'wide' },
  { id: 'gender', label: 'Gender', input: 'gender' },
  { id: 'profile', label: 'Profile page', input: 'url', autoComplete: 'url' },
  { id: 'website', label: 'Website', input: 'url', autoComplete: 'url' },
  { id: 'picture', label: 'Picture', input: 'picture', autoComplete: 'photo' },
  { id: 'birthdate', label: 'Birthdate', input: 'birthdate' },
  { id: 'zoneinfo', label: 'Time zone', input: 'zone' },
  { id: 'locale', label: 'Locale', input: 'locale' },
];

// The formatted address is the whole address as one text; HTML names no
// autofill purpose for that.
export const ADDRESS_CLAIMS: readonly ClaimField[] = [
  { id: 'address_formatted', label: 'Formatted address', input: 'text', span: 'full' },
  {
    id: 'address_street',
    label: 'Street',
    input: 'text',
    autoComplete: 'street-address',
    span: 'wide',
  },
  { id: 'address_locality', label: 'Locality', input: 'text', autoComplete: 'address-level2' },
  { id: 'address_region', label: 'Region', input: 'text', autoComplete: 'address-level1' },
  { id: 'address_postal_code', label: 'Postal code', input: 'text', autoComplete: 'postal-code' },
  { id: 'address_country', label: 'Country', input: 'country' },
];

export const PROFILE_SECTIONS = [
  { id: 'name', title: 'Name', claims: NAME_CLAIMS },
  { id: 'details', title: 'Details', claims: DETAIL_CLAIMS },
  { id: 'address', title: 'Address', claims: ADDRESS_CLAIMS },
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function claimFields(
  profile: Profile,
  claims: readonly ClaimField[],
): SectionFields<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    claims.map((claim) => [
      claim.id,
      { value: profile[claim.id] ?? '', label: claim.label, kind: 'plain' as const },
    ]),
  );
}

export function verificationFields(
  profile: Pick<Profile, 'email_verified' | 'phone_number_verified'>,
): SectionFields<{ email_verified: boolean; phone_number_verified: boolean }> {
  const describe = (value: unknown): string => flagText(value, 'verified', 'not verified');
  return {
    email_verified: {
      value: profile.email_verified,
      label: 'Email verified',
      kind: 'plain',
      describe,
    },
    phone_number_verified: {
      value: profile.phone_number_verified,
      label: 'Phone number verified',
      kind: 'plain',
      describe,
    },
  };
}
