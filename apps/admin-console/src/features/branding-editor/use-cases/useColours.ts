import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useRefusal } from '#/entities/session';
import { colourSave } from '#/features/branding-editor/repository/themeSaves';
import { fontChoice, type PaletteKey } from '#/features/branding-editor/services/palette';
import {
  themeRefusal,
  writeCapability,
  themeRecord,
  type ThemeScope,
} from '#/features/branding-editor/services/themeScope';
import { SCHEMES, type Scheme } from '#/features/branding-editor/services/colourScheme';
import {
  coloursHold,
  customisedPalette,
  editedPalette,
  paletteField,
  changedColours,
} from '#/features/branding-editor/services/colourEdits';
import { colourValues, type ColourValues } from '#/features/branding-editor/services/colourValues';
import {
  COLOUR_WORDS,
  COLOURS_TITLE,
  colourFields,
  fontView,
  schemeView,
  type ColourWords,
  type FontView,
  type SchemeView,
} from '#/features/branding-editor/services/colourSection';
import { useSectionHold } from '#/features/branding-editor/use-cases/useSectionHold';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { useFolds } from '#/shared/lib/use-cases/useFolds';

export interface Colours {
  save: SectionSave<ColourValues>;
  blocked: string | undefined;
  words: ColourWords;
  font: FontView;
  schemes: SchemeView[];
  customise: (scheme: Scheme, custom: boolean) => void;
  setColour: (scheme: Scheme, key: PaletteKey, text: string) => void;
  setFont: (id: string) => void;
  toggle: (scheme: Scheme) => void;
}

export function useColours({
  tenant,
  scope,
  view,
  tag,
  gone,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
}): Colours {
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: themeRecord(scope),
    section: 'colours',
    label: COLOURS_TITLE,
    etag: tag,
    capability: writeCapability(scope),
    gone,
    refusal,
    explain: themeRefusal(scope),
    fields: colourFields(colourValues(view)),
    save: colourSave(tenant, scope, view),
  });
  const blocked = useSectionHold(tenant, scope, coloursHold(save.values), save.saving);
  const folds = useFolds();
  const saved = colourValues(view);
  return {
    save,
    blocked,
    words: COLOUR_WORDS,
    font: fontView(scope, view, {
      value: save.values['tokens.font'],
      error: save.fieldErrors['tokens.font'],
      changed: save.changed.includes('tokens.font'),
    }),
    schemes: SCHEMES.map((scheme) => {
      const field = paletteField(scheme);
      return schemeView(scheme, scope, view, {
        palette: save.values[field],
        fieldError: save.fieldErrors[field],
        fieldChanged: save.changed.includes(field),
        changedKeys: changedColours(saved[field], save.values[field]),
        opened: folds.isOpen(scheme),
      });
    }),
    toggle: folds.toggle,
    customise: (scheme, custom) => {
      save.edit(paletteField(scheme), customisedPalette(scheme, custom));
    },
    setColour: (scheme, key, text) => {
      save.edit(paletteField(scheme), editedPalette(save.values, scheme, key, text));
    },
    setFont: (id) => {
      save.edit('tokens.font', fontChoice(id));
    },
  };
}
