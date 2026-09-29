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

// Regions whose numbers keep their leading 0 in international form.
const KEEPS_LEADING_ZERO = new Set(['IT', 'SM', 'VA', 'CI']);

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

function nationalDigits(region: string, national: string): string {
  const digits = national.replace(/[^0-9]/gu, '');
  return KEEPS_LEADING_ZERO.has(region) ? digits : digits.replace(/^0/u, '');
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
  return `+${code}${nationalDigits(region, national)}${ext}`;
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
