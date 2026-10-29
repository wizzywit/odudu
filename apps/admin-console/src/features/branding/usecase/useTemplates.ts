import type { ThemeView } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { templateSave } from '#/features/branding/repository/themeSaves';
import {
  firstProblems,
  limitedIssues,
  publishedTemplateProblems,
  type PublishOutcome,
  templateProblems,
  templateSize,
  templateField,
  templateFields,
  templateValues,
  TEMPLATES_SECTION_TITLE,
  themeRecord,
  type PageKind,
  type PlacedProblems,
  type TemplateValues,
  type ThemeScope,
  themeRefusal,
  writeCapability,
} from '#/features/branding/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import type { SizeReading } from '#/shared/service/format';

export interface Templates {
  save: SectionSave<TemplateValues>;
  text: (kind: PageKind) => string;
  // What the server refused in this kind's template, with the lines to mark.
  problems: (kind: PageKind) => PlacedProblems;
  size: (kind: PageKind) => SizeReading;
  edit: (kind: PageKind, text: string) => void;
  changed: (kind: PageKind) => boolean;
}

export function useTemplates({
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
  // What the last publish answered, for a refusal of a template in it.
  published: PublishOutcome;
}): Templates {
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: themeRecord(scope),
    section: 'templates',
    label: TEMPLATES_SECTION_TITLE,
    etag: tag,
    capability: writeCapability(scope),
    gone,
    refusal,
    explain: themeRefusal(scope),
    fields: templateFields(templateValues(view)),
    save: templateSave(tenant, scope, view),
  });
  return {
    save,
    text: (kind) => save.values[templateField(kind)],
    problems: (kind) =>
      firstProblems(
        templateProblems(
          kind,
          save.refusals[templateField(kind)] ?? [],
          limitedIssues(save.fieldErrors[templateField(kind)]),
        ),
        publishedTemplateProblems(kind, published, tag, save.changed.includes(templateField(kind))),
      ),
    size: (kind) => templateSize(save.values[templateField(kind)]),
    edit: (kind, text) => {
      save.edit(templateField(kind), text);
    },
    changed: (kind) => save.changed.includes(templateField(kind)),
  };
}
