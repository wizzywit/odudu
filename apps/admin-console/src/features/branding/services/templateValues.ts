import { THEME_PAGE_KINDS, type ThemeBodyRequest } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import type { PageKind } from '#/features/branding/services/pageKinds';
import { baseBody } from '#/features/branding/services/themeBody';

export type TemplateField = `templates.${PageKind}`;

export type TemplateValues = Readonly<Record<TemplateField, string>> &
  Readonly<Record<string, unknown>>;

export function templateField(kind: PageKind): TemplateField {
  return `templates.${kind}`;
}

export const TEMPLATE_FIELDS: readonly TemplateField[] = THEME_PAGE_KINDS.map(templateField);

// An empty template is none: the page uses the layer below.
export function templateValues(view: ThemeView): TemplateValues {
  const { templates } = baseBody(view);
  return Object.fromEntries(
    THEME_PAGE_KINDS.map((kind) => [templateField(kind), templates[kind] ?? '']),
  ) as TemplateValues;
}

function templatesOf(values: TemplateValues): ThemeBodyRequest['templates'] {
  return Object.fromEntries(
    THEME_PAGE_KINDS.flatMap((kind) => {
      const text = values[templateField(kind)];
      return text.trim() === '' ? [] : [[kind, text]];
    }),
  );
}

export function templateRequest(view: ThemeView, values: TemplateValues): ThemeBodyRequest {
  return { ...baseBody(view), templates: templatesOf(values) };
}
