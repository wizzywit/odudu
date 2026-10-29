import type { ThemeView } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { colourSave } from '#/features/branding/repository/themeSaves';
import {
  changedColours,
  colourFields,
  colourValues,
  coloursHold,
  COLOURS_TITLE,
  customisedPalette,
  editedPalette,
  fontChoice,
  paletteField,
  themeRecord,
  type ColourValues,
  type PaletteKey,
  type Scheme,
  type ThemeScope,
  themeRefusal,
  writeCapability,
} from '#/features/branding/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';

export interface Colours {
  save: SectionSave<ColourValues>;
  blocked: string | undefined;
  customise: (scheme: Scheme, custom: boolean) => void;
  setColour: (scheme: Scheme, key: PaletteKey, text: string) => void;
  setFont: (id: string) => void;
  // The colours of a scheme that differ from the saved palette.
  changedKeys: (scheme: Scheme) => readonly PaletteKey[];
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
  return {
    save,
    blocked: coloursHold(save.values),
    customise: (scheme, custom) => {
      save.edit(paletteField(scheme), customisedPalette(scheme, custom));
    },
    setColour: (scheme, key, text) => {
      save.edit(paletteField(scheme), editedPalette(save.values, scheme, key, text));
    },
    changedKeys: (scheme) =>
      changedColours(colourValues(view)[paletteField(scheme)], save.values[paletteField(scheme)]),
    setFont: (id) => {
      save.edit('tokens.font', fontChoice(id));
    },
  };
}
