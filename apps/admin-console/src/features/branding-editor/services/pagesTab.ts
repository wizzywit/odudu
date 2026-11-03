import type { ThemeView } from '#/features/branding-editor/types/theme';
import {
  MANIFESTS,
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  PAGE_PICKER_LABEL,
  PAGES_LEAD,
  slot,
  type PageKind,
} from '#/features/branding-editor/services/pageKinds';
import { sourceReading } from '#/features/branding-editor/services/sources';
import {
  formNote,
  MESSAGE_NOTE,
  OPTIONAL_NOTE,
  PARTS_TITLE,
  REQUIRED_NOTE,
  TEMPLATE_LABEL,
  TEMPLATE_RULES,
  TEMPLATES_INTRO,
  TEMPLATES_SECTION_TITLE,
  templateDescription,
} from '#/features/branding-editor/services/templateParts';
import { templateField } from '#/features/branding-editor/services/templateValues';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

export interface PagesWords {
  title: string;
  lead: string;
  pickerLabel: string;
  pickerOptions: typeof PAGE_KIND_OPTIONS;
}

export const PAGES_WORDS: PagesWords = {
  title: TEMPLATES_SECTION_TITLE,
  lead: PAGES_LEAD,
  pickerLabel: PAGE_PICKER_LABEL,
  pickerOptions: PAGE_KIND_OPTIONS,
};

export interface TemplateWords {
  label: string;
  description: string;
}

// What the template editor of a kind says of itself and of where it comes from.
export function templateWords(kind: PageKind, scope: ThemeScope, view: ThemeView): TemplateWords {
  return {
    label: `${PAGE_KIND_LABELS[kind]}: ${TEMPLATE_LABEL.toLowerCase()}`,
    description: `${sourceReading(scope, view, templateField(kind))}. ${templateDescription()}`,
  };
}

export interface PartsView {
  title: string;
  open: boolean;
  intro: string;
  required: { note: string; parts: string[] };
  optional: { note: string; parts: string[] } | null;
  inside: string | null;
  notes: string[];
}

// The parts a page of one kind is made of, said as the fold lists them.
export function partsView(kind: PageKind, open: boolean): PartsView {
  const manifest = MANIFESTS[kind];
  return {
    title: PARTS_TITLE,
    open,
    intro: TEMPLATES_INTRO,
    required: { note: REQUIRED_NOTE, parts: manifest.required.map(slot) },
    optional:
      manifest.optional.length === 0
        ? null
        : { note: OPTIONAL_NOTE, parts: manifest.optional.map(slot) },
    inside: formNote(manifest),
    notes: [MESSAGE_NOTE, TEMPLATE_RULES],
  };
}
