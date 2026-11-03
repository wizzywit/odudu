export type Scheme = 'light' | 'dark';

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

// The scheme a control's id names, or nothing for any other.
export function schemeOf(id: string): Scheme | undefined {
  return SCHEMES.find((scheme) => scheme === id);
}

export const SCHEME_LABELS: Readonly<Record<Scheme, string>> = { light: 'Light', dark: 'Dark' };
