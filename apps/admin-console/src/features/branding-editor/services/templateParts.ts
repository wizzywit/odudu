import { MAX_TEMPLATE_BYTES, THEME_PAGE_KINDS } from '@odudu/contracts';
import { bytesText, shortened } from '#/shared/lib/services/format';
import {
  templateField,
  type TemplateValues,
} from '#/features/branding-editor/services/templateValues';
import {
  type PageKind,
  type Manifest,
  slot,
  MANIFESTS,
  PAGE_KIND_LABELS,
} from '#/features/branding-editor/services/pageKinds';
import type { SectionFields } from '#/shared/lib/services/sectionSave';

const FORM = ['form.open', 'form.close'];

export const TEMPLATES_INTRO =
  'A template is the HTML of one page. Leave it empty to use the layer below. The server fills in every part itself; a template only decides where each one sits.';

export const MESSAGE_NOTE =
  'Wording comes from the catalogue: {{t "key"}} inserts the message with that key in the visitor’s language. A key the page’s catalogue does not have is refused when you save.';

export const TEMPLATE_RULES =
  'Plain HTML only. Scripts, styles, forms, inputs, frames and event attributes are refused, and links must be https.';

export const TEMPLATE_LABEL = 'Template';

export function templateDescription(): string {
  return `Up to ${bytesText(MAX_TEMPLATE_BYTES)}. Empty uses the layer below.`;
}

export const PARTS_TITLE = 'Parts of this page';

export const REQUIRED_NOTE = 'Required, each exactly once:';

export const OPTIONAL_NOTE = 'Optional, at most once:';

export function formNote(manifest: Manifest): string | null {
  const inside = manifest.inForm.map(slot).join(', ');
  return inside === ''
    ? null
    : `Between ${slot(FORM[0] ?? '')} and ${slot(FORM[1] ?? '')}: ${inside}.`;
}

const SCRIPT_NOTE = 'This page uses a script, which the preview leaves out. The real page runs it.';

// What the preview of a kind leaves out, when it leaves anything.
export function omissionNote(kind: PageKind): string | null {
  return MANIFESTS[kind].required.includes('script') ? SCRIPT_NOTE : null;
}

export const TEMPLATES_SECTION_TITLE = 'Page templates';

const SHOWN_TEMPLATE = 60;

export function describeTemplate(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'none';
  return shortened(value, SHOWN_TEMPLATE);
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
