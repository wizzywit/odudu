import { shortened } from '#/shared/services/format';
import type { SectionFields } from '#/shared/services/sectionSave';
import { PAGE_KIND_LABELS } from '#/features/branding/services/templates';
import {
  templateField,
  type StylesheetValues,
  type TemplateValues,
} from '#/features/branding/services/values';
import { THEME_PAGE_KINDS } from '@odudu/contracts';
import { IMAGES_TITLE } from '#/features/branding/services/imageSection';
import { COLOURS_TITLE } from '#/features/branding/services/colourSection';

export const TEMPLATES_SECTION_TITLE = 'Page templates';

export const STYLESHEET_SECTION_TITLE = 'Stylesheet';

const SHOWN_TEMPLATE = 60;

function describeTemplate(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'none';
  return shortened(value, SHOWN_TEMPLATE);
}

export function stylesheetFields(now: StylesheetValues): SectionFields<StylesheetValues> {
  return {
    stylesheet: {
      value: now.stylesheet,
      label: STYLESHEET_SECTION_TITLE,
      kind: 'plain',
      describe: describeTemplate,
    },
  };
}

export function templateFields(now: TemplateValues): SectionFields<TemplateValues> {
  return Object.fromEntries(
    THEME_PAGE_KINDS.map((kind) => [
      templateField(kind),
      {
        value: now[templateField(kind)],
        label: PAGE_KIND_LABELS[kind],
        kind: 'plain' as const,
        describe: describeTemplate,
      },
    ]),
  ) as SectionFields<TemplateValues>;
}

const SECTION_TITLES: Readonly<Record<string, string>> = {
  colours: COLOURS_TITLE,
  images: IMAGES_TITLE,
  stylesheet: STYLESHEET_SECTION_TITLE,
  templates: TEMPLATES_SECTION_TITLE,
};

// The titles of the sections holding unsaved edits, in the order they sit.
export function unsavedSections(dirty: ReadonlySet<string>): readonly string[] {
  return Object.entries(SECTION_TITLES)
    .filter(([id]) => dirty.has(id))
    .map(([, title]) => title);
}
