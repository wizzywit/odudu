import type { SectionFields } from '#/shared/services/sectionSave';
import {
  schemeColoursName,
  schemeColoursTitle,
  type Scheme,
} from '#/features/branding/services/colourScheme';
import type { ColourValues } from '#/features/branding/services/colourValues';

export const COLOURS_LEAD =
  'Light and dark are two palettes, each used whole: customise one and every colour in it is yours, so a colour can never be left to clash. A scheme you leave alone keeps Instrument’s own colours.';

export const FONT_LABEL = 'Font';

export function customLabel(scheme: Scheme): string {
  return `Use my own ${schemeColoursName(scheme)}`;
}

// Narrow, each palette is a fold under its legend. One that holds a problem
// stays open, so it is not hidden from the person who has to fix it.
export function paletteFoldOpen(
  opened: boolean,
  fieldError: string | undefined,
  colourProblems: Readonly<Record<string, string | undefined>>,
): boolean {
  return opened || fieldError !== undefined || Object.keys(colourProblems).length > 0;
}

export const COLOURS_TITLE = 'Colours and font';

function describePalette(value: unknown): string {
  return value === null ? 'Instrument’s own colours' : 'custom colours';
}

// A theme is saved whole, so each section names its own pieces.
export function colourFields(now: ColourValues): SectionFields<ColourValues> {
  return {
    'tokens.light': {
      value: now['tokens.light'],
      label: schemeColoursTitle('light'),
      kind: 'plain',
      describe: describePalette,
    },
    'tokens.dark': {
      value: now['tokens.dark'],
      label: schemeColoursTitle('dark'),
      kind: 'plain',
      describe: describePalette,
    },
    'tokens.font': { value: now['tokens.font'], label: 'Font', kind: 'plain' },
  };
}
