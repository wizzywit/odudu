import { isValidBirthdate } from '@odudu/contracts';

// The three forms OIDC Core §5.1 gives a birthdate: YYYY-MM-DD, YYYY alone,
// and 0000-MM-DD for a day and month whose year is withheld.
export type Birthdate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'date'; readonly year: number; readonly month: number; readonly day: number }
  | { readonly kind: 'year'; readonly year: number }
  | { readonly kind: 'no-year'; readonly month: number; readonly day: number }
  // Stored in the claim's shape but naming no day that exists.
  | { readonly kind: 'other'; readonly raw: string };

export type BirthdateForm = 'date' | 'year' | 'no-year';

export function daysIn(month: number, year: number | null): number {
  // A withheld year may hide a leap year, so 29 February stays possible.
  return new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function readBirthdate(value: string): Birthdate {
  if (value === '') return { kind: 'empty' };
  if (!isValidBirthdate(value)) return { kind: 'other', raw: value };
  const [year = 0, month, day] = value.split('-').map(Number);
  if (month === undefined || day === undefined) {
    return year === 0 ? { kind: 'other', raw: value } : { kind: 'year', year };
  }
  const known = year === 0 ? null : year;
  if (month < 1 || month > 12 || day < 1 || day > daysIn(month, known)) {
    return { kind: 'other', raw: value };
  }
  return known === null ? { kind: 'no-year', month, day } : { kind: 'date', year, month, day };
}

export function composeBirthdate(birthdate: Birthdate): string {
  switch (birthdate.kind) {
    case 'empty':
      return '';
    case 'other':
      return birthdate.raw;
    case 'year':
      return pad(birthdate.year, 4);
    case 'no-year':
      return `0000-${pad(birthdate.month, 2)}-${pad(birthdate.day, 2)}`;
    case 'date':
      return `${pad(birthdate.year, 4)}-${pad(birthdate.month, 2)}-${pad(birthdate.day, 2)}`;
  }
}

export function formOf(birthdate: Birthdate): BirthdateForm | null {
  switch (birthdate.kind) {
    case 'date':
    case 'year':
    case 'no-year':
      return birthdate.kind;
    case 'empty':
    case 'other':
      return null;
  }
}

// What survives a change of form: the year into "year only", the day and
// month into "year withheld"; anything else starts empty.
export function convertBirthdate(birthdate: Birthdate, to: BirthdateForm): Birthdate {
  if (birthdate.kind === 'date' && to === 'year') return { kind: 'year', year: birthdate.year };
  if (birthdate.kind === 'date' && to === 'no-year') {
    return { kind: 'no-year', month: birthdate.month, day: birthdate.day };
  }
  return birthdate.kind === to ? birthdate : { kind: 'empty' };
}

export interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function birthdateProblem(birthdate: Birthdate, today: Day): string | null {
  const future =
    (birthdate.kind === 'year' && birthdate.year > today.year) ||
    (birthdate.kind === 'date' &&
      Date.UTC(birthdate.year, birthdate.month - 1, birthdate.day) >
        Date.UTC(today.year, today.month - 1, today.day));
  return future ? 'A birthdate cannot be in the future.' : null;
}
