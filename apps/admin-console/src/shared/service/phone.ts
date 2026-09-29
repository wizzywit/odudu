import { isValidE164 } from '@odudu/contracts';
import { callingCodeOf, REGIONS } from '#/shared/service/regions.ts';

export interface PhoneParts {
  // Null when the stored number is not in international form.
  readonly region: string | null;
  readonly national: string;
  readonly extension: string | null;
}

// Where several regions share a calling code, the one a stored number is
// shown under until somebody chooses another; the number stored is the same.
const USUAL: Readonly<Record<string, string>> = {
  '1': 'US',
  '7': 'RU',
  '39': 'IT',
  '44': 'GB',
  '47': 'NO',
  '61': 'AU',
  '64': 'NZ',
  '212': 'MA',
  '262': 'RE',
  '358': 'FI',
  '500': 'FK',
  '590': 'GP',
  '599': 'CW',
  '672': 'NF',
};

// The trunk prefix a number dialled at home starts with and E.164 drops:
// "0" unless named here. `length` is the digit count the prefixed number
// has, where a prefix is also a plausible first digit of the number itself.
interface Trunk {
  readonly prefix: string;
  readonly length?: number;
}

const NONE: Trunk = { prefix: '' };
const EIGHT: Trunk = { prefix: '8' };
const TRUNKS: Readonly<Record<string, Trunk>> = {
  RU: { prefix: '8', length: 11 },
  KZ: { prefix: '8', length: 11 },
  BY: { prefix: '80' },
  LT: EIGHT,
  TM: EIGHT,
  TJ: EIGHT,
  UZ: EIGHT,
  HU: { prefix: '06' },
  // Italy and its neighbours, and Côte d'Ivoire, keep the leading 0.
  IT: NONE,
  SM: NONE,
  VA: NONE,
  CI: NONE,
};

const NANP: Trunk = { prefix: '1', length: 11 };

function trunkOf(region: string): Trunk {
  return TRUNKS[region] ?? (callingCodeOf(region) === '1' ? NANP : { prefix: '0' });
}

// The national significant number: the one step a phone-number library
// (libphonenumber-js) would take over, since it alone knows each numbering plan.
export function nationalSignificant(region: string, national: string): string {
  const digits = national.replace(/[^0-9]/gu, '');
  const { prefix, length } = trunkOf(region);
  const prefixed =
    prefix !== '' &&
    digits.startsWith(prefix) &&
    (length === undefined || digits.length === length);
  return prefixed ? digits.slice(prefix.length) : digits;
}

const INTERNATIONAL = /^\+([0-9]+)(?:;ext=([0-9]+))?$/u;
const DIALLED = /^[0-9 ().-]*$/u;

function regionsWith(code: string): readonly string[] {
  return REGIONS.filter((region) => region.callingCode === code).map((region) => region.code);
}

export function splitPhone(value: string, preferred: string | null = null): PhoneParts {
  const match = INTERNATIONAL.exec(value);
  const digits = match?.[1];
  if (digits === undefined) return { region: null, national: value, extension: null };
  const extension = match?.[2] ?? null;
  for (const length of [3, 2, 1]) {
    const code = digits.slice(0, length);
    const sharing = regionsWith(code);
    if (sharing.length === 0) continue;
    const region =
      preferred !== null && sharing.includes(preferred)
        ? preferred
        : (USUAL[code] ?? sharing[0] ?? null);
    return { region, national: digits.slice(length), extension };
  }
  return { region: null, national: value, extension: null };
}

// E.164 from a country and a number typed as it is dialled at home: the
// punctuation goes, and so does the trunk 0 international dialling drops.
export function composePhone(
  region: string | null,
  national: string,
  extension: string | null,
): string {
  if (national.trim() === '') return '';
  const code = region === null ? null : callingCodeOf(region);
  if (region === null || code === null) return national;
  const ext = extension === null ? '' : `;ext=${extension}`;
  return `+${code}${nationalSignificant(region, national)}${ext}`;
}

export type PhonePart = 'region' | 'number';

// Which control a problem is about, so only that one is marked invalid.
export function phoneProblemPart(region: string | null, national: string): PhonePart | null {
  if (national.trim() === '') return null;
  if (region === null) return 'region';
  return phoneProblem(region, national) === null ? null : 'number';
}

export function phoneProblem(region: string | null, national: string): string | null {
  if (national.trim() === '') return null;
  if (region === null) return 'Choose the country the number is in.';
  if (!DIALLED.test(national)) {
    return 'Use digits only; spaces, dashes, dots and brackets are ignored.';
  }
  return isValidE164(composePhone(region, national, null))
    ? null
    : 'Too long: a phone number has at most 15 digits, country code included.';
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
