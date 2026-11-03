import type { FontChoice, ThemeBodyRequest } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import type { Palette } from '#/features/branding/services/palette';
import { baseBody } from '#/features/branding/services/themeBody';

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

// A save replaces the whole draft, so the part not being saved is carried
// over from the base it was read with.
export function colourRequest(view: ThemeView, values: ColourValues): ThemeBodyRequest {
  return { ...baseBody(view), tokens: tokensOf(values) };
}
