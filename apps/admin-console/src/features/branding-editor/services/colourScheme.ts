export type Scheme = 'light' | 'dark';

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

// The scheme a control's id names, or nothing for any other.
export function schemeOf(id: string): Scheme | undefined {
  return SCHEMES.find((scheme) => scheme === id);
}

export const SCHEME_LABELS: Readonly<Record<Scheme, string>> = { light: 'Light', dark: 'Dark' };

export const schemeOptions: readonly { id: Scheme; label: string }[] = SCHEMES.map((id) => ({
  id,
  label: SCHEME_LABELS[id],
}));

export const SCHEME_PICKER_LABEL = 'Colour scheme';

// "Light colours", for a title or a field's label.
export function schemeColoursTitle(scheme: Scheme): string {
  return `${SCHEME_LABELS[scheme]} colours`;
}

// "light colours", for a sentence that names the piece.
export function schemeColoursName(scheme: Scheme): string {
  return schemeColoursTitle(scheme).toLowerCase();
}
