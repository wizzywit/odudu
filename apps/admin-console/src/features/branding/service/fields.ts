import { shortened } from '#/shared/service/format';
import type { SectionFields } from '#/shared/service/sectionSave';
import { PAGE_KIND_LABELS } from '#/features/branding/service/templates';
import {
  type ImageSlot,
  templateField,
  type ColourValues,
  type ImageValues,
  type StylesheetValues,
  type TemplateValues,
} from '#/features/branding/service/values';
import { SLOT_RULES } from '#/features/branding/service/assets';
import { THEME_PAGE_KINDS } from '@odudu/contracts';

export const COLOURS_TITLE = 'Colours and font';
export const IMAGES_TITLE = 'Images';
export const TEMPLATES_SECTION_TITLE = 'Page templates';
export const STYLESHEET_SECTION_TITLE = 'Stylesheet';

function describePalette(value: unknown): string {
  return value === null ? 'Instrument’s own colours' : 'custom colours';
}

function describeImage(value: unknown): string {
  return value === null ? 'no image' : 'an uploaded image';
}

const SHOWN_TEMPLATE = 60;

function describeTemplate(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'none';
  return shortened(value, SHOWN_TEMPLATE);
}

// A theme is saved whole, so each section names its own pieces.
export function colourFields(now: ColourValues): SectionFields<ColourValues> {
  return {
    'tokens.light': {
      value: now['tokens.light'],
      label: 'Light colours',
      kind: 'plain',
      describe: describePalette,
    },
    'tokens.dark': {
      value: now['tokens.dark'],
      label: 'Dark colours',
      kind: 'plain',
      describe: describePalette,
    },
    'tokens.font': { value: now['tokens.font'], label: 'Font', kind: 'plain' },
  };
}

function imageEntry<V>(slot: ImageSlot, value: V) {
  return { value, label: SLOT_RULES[slot].label, kind: 'plain' as const, describe: describeImage };
}

export function imageFields(now: ImageValues): SectionFields<ImageValues> {
  return {
    'assets.logo': imageEntry('logo', now['assets.logo']),
    'assets.darkLogo': imageEntry('darkLogo', now['assets.darkLogo']),
    'assets.favicon': imageEntry('favicon', now['assets.favicon']),
    'assets.background': imageEntry('background', now['assets.background']),
  };
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
