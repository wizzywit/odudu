import type { ThemeBodyWire } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';

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
