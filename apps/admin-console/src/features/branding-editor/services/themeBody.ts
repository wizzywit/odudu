import type { ThemeBody, ThemeView } from '#/features/branding-editor/types/theme';

export const EMPTY_BODY: ThemeBody = {
  tokens: {},
  stylesheet: null,
  templates: {},
  assets: {},
};

// What a save of the theme starts from: the draft, or with none the published
// theme it would be made from.
export function baseBody(view: ThemeView): ThemeBody {
  return view.draft ?? view.published?.body ?? EMPTY_BODY;
}
