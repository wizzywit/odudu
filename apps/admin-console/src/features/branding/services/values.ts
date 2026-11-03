import {
  THEME_PAGE_KINDS,
  type FontChoice,
  type ThemeBodyRequest,
  type ThemeBodyWire,
} from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import { nullWhenBlank } from '#/shared/services/format';
import type { Palette } from '#/features/branding/services/palette';

export type PageKind = (typeof THEME_PAGE_KINDS)[number];

export const EMPTY_BODY: ThemeBodyWire = {
  tokens: {},
  stylesheet: null,
  templates: {},
  assets: {},
};

// What a save of the theme starts from: the draft, or with none the published
// theme it would be made from.
export function baseBody(view: ThemeView): ThemeBodyWire {
  return view.draft ?? view.published?.body ?? EMPTY_BODY;
}

// The fields are named for the pieces the server names, so a refusal at
// `tokens.light.inkPrimary` lands on the field that holds it.
export interface ColourValues extends Readonly<Record<string, unknown>> {
  'tokens.light': Palette | null;
  'tokens.dark': Palette | null;
  'tokens.font': FontChoice | null;
}

export function colourValues(view: ThemeView): ColourValues {
  const { tokens } = baseBody(view);
  return {
    'tokens.light': tokens.light ?? null,
    'tokens.dark': tokens.dark ?? null,
    'tokens.font': tokens.font ?? null,
  };
}

function tokensOf(values: ColourValues): ThemeBodyRequest['tokens'] {
  return {
    ...(values['tokens.light'] === null ? {} : { light: values['tokens.light'] }),
    ...(values['tokens.dark'] === null ? {} : { dark: values['tokens.dark'] }),
    ...(values['tokens.font'] === null ? {} : { font: values['tokens.font'] }),
  };
}

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

export interface StylesheetValues extends Readonly<Record<string, unknown>> {
  stylesheet: string;
}

// An empty stylesheet is none: the page uses the layer below.
export function stylesheetValues(view: ThemeView): StylesheetValues {
  return { stylesheet: baseBody(view).stylesheet ?? '' };
}

// A save replaces the whole draft, so the part not being saved is carried
// over from the base it was read with.
export function colourRequest(view: ThemeView, values: ColourValues): ThemeBodyRequest {
  return { ...baseBody(view), tokens: tokensOf(values) };
}

export function stylesheetRequest(view: ThemeView, values: StylesheetValues): ThemeBodyRequest {
  return {
    ...baseBody(view),
    stylesheet: nullWhenBlank(values.stylesheet),
  };
}

export function templateRequest(view: ThemeView, values: TemplateValues): ThemeBodyRequest {
  return { ...baseBody(view), templates: templatesOf(values) };
}
