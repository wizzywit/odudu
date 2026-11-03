import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useRefusal } from '#/entities/session';
import { templateSave } from '#/features/branding-editor/repository/themeSaves';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import {
  templateFields,
  TEMPLATES_SECTION_TITLE,
} from '#/features/branding-editor/services/templateParts';
import { firstProblems, type PlacedProblems } from '#/features/branding-editor/services/problems';
import {
  themeRefusal,
  writeCapability,
  themeRecord,
  type ThemeScope,
} from '#/features/branding-editor/services/themeScope';
import { limitedIssues } from '#/features/branding-editor/services/publishIssues';
import { templateSize } from '#/features/branding-editor/services/stylesheet';
import type { PageKind } from '#/features/branding-editor/services/pageKinds';
import { templateProblemsFor } from '#/features/branding-editor/services/templateProblems';
import {
  templateField,
  templateValues,
  type TemplateValues,
} from '#/features/branding-editor/services/templateValues';
import { useSectionHold } from '#/features/branding-editor/use-cases/useSectionHold';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import type { SizeReading } from '#/shared/services/format';

export interface Templates {
  save: SectionSave<TemplateValues>;
  blocked: string | undefined;
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
  const blocked = useSectionHold(tenant, scope, undefined, save.saving);
  return {
    save,
    blocked,
    text: (kind) => save.values[templateField(kind)],
    problems: (kind) =>
      firstProblems(
        templateProblemsFor(kind).save(
          save.refusals[templateField(kind)] ?? [],
          limitedIssues(save.fieldErrors[templateField(kind)]),
        ),
        templateProblemsFor(kind).publish(
          published,
          tag,
          save.changed.includes(templateField(kind)),
        ),
      ),
    size: (kind) => templateSize(save.values[templateField(kind)]),
    edit: (kind, text) => {
      save.edit(templateField(kind), text);
    },
    changed: (kind) => save.changed.includes(templateField(kind)),
  };
}
