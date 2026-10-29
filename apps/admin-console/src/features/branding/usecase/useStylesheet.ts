import type { ThemeView } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { stylesheetSave } from '#/features/branding/repository/themeSaves';
import {
  firstProblems,
  publishedStylesheetProblems,
  type PublishOutcome,
  stylesheetFields,
  stylesheetHold,
  stylesheetProblems,
  stylesheetSize,
  stylesheetValues,
  STYLESHEET_PATH,
  STYLESHEET_SECTION_TITLE,
  themeRecord,
  type PlacedProblems,
  type StylesheetValues,
  type ThemeScope,
  themeRefusal,
  writeCapability,
} from '#/features/branding/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import type { SizeReading } from '#/shared/service/format';

export interface Stylesheet {
  save: SectionSave<StylesheetValues>;
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
  return {
    save,
    text,
    size: stylesheetSize(text),
    blocked: stylesheetHold(text),
    problems: firstProblems(
      stylesheetProblems(save.refusals.stylesheet ?? [], save.fieldErrors[STYLESHEET_PATH]),
      publishedStylesheetProblems(published, tag, changed),
    ),
    edit: (next) => {
      save.edit('stylesheet', next);
    },
    changed,
  };
}
