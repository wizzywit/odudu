import { isValidE164 } from '@odudu/contracts';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js/min';

// Numbering plans come from libphonenumber-js's `min` metadata: each
// country's trunk prefix and its possible lengths. Only the phone field's
// chunk imports this module, so the metadata never reaches the entry
// (tests/lint/console-phone-chunk.test.ts).

export interface PhoneParts {
  // Null when the stored number is not in international form.
  readonly region: string | null;
  readonly national: string;
  readonly extension: string | null;
}

const COUNTRIES: ReadonlySet<string> = new Set(getCountries());

function countryCode(region: string): CountryCode | null {
  return COUNTRIES.has(region) ? (region as CountryCode) : null;
}

export function phoneRegions(): readonly string[] {
  return [...COUNTRIES];
}

export function callingCodeOf(region: string): string | null {
  const code = countryCode(region);
  return code === null ? null : getCountryCallingCode(code);
}

const INTERNATIONAL = /^\+([0-9]+)(?:;ext=([0-9]+))?$/u;
const DIALLED = /^[0-9 ().-]*$/u;

export function splitPhone(value: string, preferred: string | null = null): PhoneParts {
  const match = INTERNATIONAL.exec(value);
  const digits = match?.[1];
  const parsed = digits === undefined ? undefined : parsePhoneNumberFromString(`+${digits}`);
  if (parsed === undefined) return { region: null, national: value, extension: null };
  const sharing = preferred === null ? null : callingCodeOf(preferred);
  const region =
    sharing === parsed.countryCallingCode
      ? preferred
      : (parsed.country ?? parsed.getPossibleCountries()[0] ?? null);
  return { region, national: parsed.nationalNumber, extension: match?.[2] ?? null };
}

// E.164 from a country and a number typed as it is dialled at home; the
// country's own trunk prefix, if it has one, is the numbering plan's to drop.
export function composePhone(
  region: string | null,
  national: string,
  extension: string | null,
): string {
  if (national.trim() === '') return '';
  const code = region === null ? null : countryCode(region);
  if (code === null) return national;
  const parsed = parsePhoneNumberFromString(national, code);
  const number =
    parsed?.number ?? `+${getCountryCallingCode(code)}${national.replace(/[^0-9]/gu, '')}`;
  return extension === null ? number : `${number};ext=${extension}`;
}

export type PhonePart = 'region' | 'number';

const TOO: Readonly<Record<string, string>> = {
  TOO_SHORT: 'Too short for a phone number in this country.',
  TOO_LONG: 'Too long for a phone number in this country.',
  INVALID_LENGTH: 'Not a length a phone number has in this country.',
};

export function phoneProblem(region: string | null, national: string): string | null {
  if (national.trim() === '') return null;
  if (region === null) return 'Choose the country the number is in.';
  if (!DIALLED.test(national)) {
    return 'Use digits only; spaces, dashes, dots and brackets are ignored.';
  }
  const code = countryCode(region);
  if (code === null) return 'Choose the country the number is in.';
  const length = validatePhoneNumberLength(national, code);
  if (length !== undefined) return TOO[length] ?? 'This is not a phone number.';
  return isValidE164(composePhone(region, national, null)) ? null : 'This is not a phone number.';
}

// Which control a problem is about, so only that one is marked invalid.
export function phoneProblemPart(region: string | null, national: string): PhonePart | null {
  if (national.trim() === '') return null;
  if (region === null) return 'region';
  return phoneProblem(region, national) === null ? null : 'number';
}

// A number pasted in its international form names its own country.
export function readTypedNumber(
  text: string,
): { readonly region: string; readonly national: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('+')) return null;
  const { region, national } = splitPhone(`+${trimmed.replace(/[^0-9]/gu, '')}`);
  return region === null ? null : { region, national };
}

// "+2" or "+23" is a calling code still being typed, not a wrong number.
export function typingInternational(text: string): boolean {
  return /^\+[0-9]*$/u.test(text.trim());
}

export function formatPhone(value: string): string {
  const match = INTERNATIONAL.exec(value);
  const digits = match?.[1];
  const parsed = digits === undefined ? undefined : parsePhoneNumberFromString(`+${digits}`);
  if (parsed === undefined) return value;
  const extension = match?.[2];
  return `${parsed.formatInternational()}${extension === undefined ? '' : ` ext. ${extension}`}`;
}
