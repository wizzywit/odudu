import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { SectionFields } from '#/shared/services/sectionSave';
import {
  SCHEME_LABELS,
  schemeColoursName,
  schemeColoursTitle,
  type Scheme,
} from '#/features/branding-editor/services/colourScheme';
import { colourProblems, swatchOf } from '#/features/branding-editor/services/colourEdits';
import type { ColourValues } from '#/features/branding-editor/services/colourValues';
import { pickLabel } from '#/features/branding-editor/services/pageKinds';
import {
  FONT_OPTIONS,
  PALETTE_LABELS,
  PALETTE_ORDER,
  type Palette,
  type PaletteKey,
} from '#/features/branding-editor/services/palette';
import { sourceReading } from '#/features/branding-editor/services/sources';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

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

export interface ColourWords {
  title: string;
  lead: string;
}

export const COLOUR_WORDS: ColourWords = { title: COLOURS_TITLE, lead: COLOURS_LEAD };

export interface FontView {
  label: string;
  description: string;
  options: typeof FONT_OPTIONS;
  value: string;
  error: string | undefined;
  changed: boolean;
}

export function fontView(
  scope: ThemeScope,
  view: ThemeView,
  edit: { value: string | null | undefined; error: string | undefined; changed: boolean },
): FontView {
  return {
    label: FONT_LABEL,
    description: sourceReading(scope, view, 'tokens.font'),
    options: FONT_OPTIONS,
    value: edit.value ?? '',
    error: edit.error,
    changed: edit.changed,
  };
}

export interface ColourFieldView {
  key: PaletteKey;
  label: string;
  value: string;
  error: string | undefined;
  changed: boolean;
  pickLabel: string;
  swatch: string;
}

export interface SchemeView {
  scheme: Scheme;
  legend: string;
  open: boolean;
  customLabel: string;
  description: string;
  custom: boolean;
  error: string | undefined;
  changed: boolean;
  colours: ColourFieldView[];
}

export interface SchemeEdit {
  palette: Palette | null;
  fieldError: string | undefined;
  fieldChanged: boolean;
  changedKeys: readonly PaletteKey[];
  opened: boolean;
}

// One scheme's fold and its palette fields, as they stand on screen.
export function schemeView(
  scheme: Scheme,
  scope: ThemeScope,
  view: ThemeView,
  edit: SchemeEdit,
): SchemeView {
  const { palette } = edit;
  const problems = colourProblems(palette);
  return {
    scheme,
    legend: schemeColoursTitle(scheme),
    open: paletteFoldOpen(edit.opened, edit.fieldError, problems),
    customLabel: customLabel(scheme),
    description: sourceReading(scope, view, `tokens.${scheme}`),
    custom: palette !== null,
    error: edit.fieldError,
    changed: edit.fieldChanged,
    colours:
      palette === null
        ? []
        : PALETTE_ORDER.map((key) => {
            const label = `${SCHEME_LABELS[scheme]} ${PALETTE_LABELS[key].label.toLowerCase()}`;
            return {
              key,
              label,
              value: palette[key],
              error: problems[key],
              changed: edit.changedKeys.includes(key),
              pickLabel: pickLabel(label),
              swatch: swatchOf(palette[key]),
            };
          }),
  };
}
