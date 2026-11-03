import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useRefusal } from '#/entities/session';
import { stylesheetSave } from '#/features/branding-editor/repository/themeSaves';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import {
  stylesheetFields,
  STYLESHEET_SECTION_TITLE,
  STYLESHEET_PROBLEMS,
  stylesheetHold,
  stylesheetSize,
  STYLESHEET_PATH,
} from '#/features/branding-editor/services/stylesheet';
import { firstProblems, type PlacedProblems } from '#/features/branding-editor/services/problems';
import {
  themeRefusal,
  writeCapability,
  themeRecord,
  type ThemeScope,
} from '#/features/branding-editor/services/themeScope';
import {
  stylesheetValues,
  type StylesheetValues,
} from '#/features/branding-editor/services/stylesheetValues';
import {
  selectorList,
  stylesheetWords,
  valueList,
  type InsertList,
  type StylesheetWords,
} from '#/features/branding-editor/services/stylesheetView';
import { useDesignValues, useSelectors } from '#/features/branding-editor/use-cases/useSelectors';
import { useSectionHold } from '#/features/branding-editor/use-cases/useSectionHold';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import type { SizeReading } from '#/shared/lib/services/format';

export interface Stylesheet {
  save: SectionSave<StylesheetValues>;
  words: StylesheetWords;
  selectors: InsertList;
  values: InsertList;
  text: string;
  size: SizeReading;
  blocked: string | undefined;
  // What the server refused in it, with the lines to mark.
  problems: PlacedProblems;
  edit: (text: string) => void;
  changed: boolean;
}

export function useStylesheet({
  tenant,
  scope,
  view,
  tag,
  gone,
  published,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
  // What the last publish answered, for a refusal of the stylesheet in it.
  published: PublishOutcome;
}): Stylesheet {
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: themeRecord(scope),
    section: 'stylesheet',
    label: STYLESHEET_SECTION_TITLE,
    etag: tag,
    capability: writeCapability(scope),
    gone,
    refusal,
    explain: themeRefusal(scope),
    fields: stylesheetFields(stylesheetValues(view)),
    save: stylesheetSave(tenant, scope, view),
  });
  const text = save.values.stylesheet;
  const changed = save.changed.includes('stylesheet');
  const blocked = useSectionHold(tenant, scope, stylesheetHold(text), save.saving);
  const selectors = useSelectors(tenant);
  const values = useDesignValues(tenant);
  return {
    save,
    words: stylesheetWords(scope, view),
    selectors: selectorList(selectors),
    values: valueList(values),
    text,
    size: stylesheetSize(text),
    blocked,
    problems: firstProblems(
      STYLESHEET_PROBLEMS.save(save.refusals.stylesheet ?? [], save.fieldErrors[STYLESHEET_PATH]),
      STYLESHEET_PROBLEMS.publish(published, tag, changed),
    ),
    edit: (next) => {
      save.edit('stylesheet', next);
    },
    changed,
  };
}
