import {
  THEME_PAGE_KINDS,
  type FontChoice,
  type ThemeBodyRequest,
  type ThemeBodyWire,
} from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import { nullWhenBlank } from '#/shared/service/format';
import type { Palette } from '#/features/branding/service/palette';

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

export type ImageSlot = 'logo' | 'darkLogo' | 'favicon' | 'background';

export const IMAGE_SLOTS: readonly ImageSlot[] = ['logo', 'darkLogo', 'favicon', 'background'];

export interface Logo {
  assetId: string;
  alt: string;
}

export interface Plain {
  assetId: string;
}

export interface ImageValues extends Readonly<Record<string, unknown>> {
  'assets.logo': Logo | null;
  'assets.darkLogo': Logo | null;
  'assets.favicon': Plain | null;
  'assets.background': Plain | null;
}

export type ImageField = `assets.${ImageSlot}`;

export function imageField(slot: ImageSlot): ImageField {
  return `assets.${slot}`;
}

export function imageValues(view: ThemeView): ImageValues {
  const { assets } = baseBody(view);
  return {
    'assets.logo': assets.logo ?? null,
    'assets.darkLogo': assets.darkLogo ?? null,
    'assets.favicon': assets.favicon ?? null,
    'assets.background': assets.background ?? null,
  };
}

function assetsOf(values: ImageValues): ThemeBodyRequest['assets'] {
  return {
    ...(values['assets.logo'] === null ? {} : { logo: values['assets.logo'] }),
    ...(values['assets.darkLogo'] === null ? {} : { darkLogo: values['assets.darkLogo'] }),
    ...(values['assets.favicon'] === null ? {} : { favicon: values['assets.favicon'] }),
    ...(values['assets.background'] === null ? {} : { background: values['assets.background'] }),
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

export function imageRequest(view: ThemeView, values: ImageValues): ThemeBodyRequest {
  return { ...baseBody(view), assets: assetsOf(values) };
}

export function templateRequest(view: ThemeView, values: TemplateValues): ThemeBodyRequest {
  return { ...baseBody(view), templates: templatesOf(values) };
}
