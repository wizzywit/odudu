import { createPageFiller } from '@odudu/kernel';
import { en, t, type MessageId } from '#/view/messages';
import { DEFAULT_TEMPLATES } from '#/view/templates/index';

// Whether the package's catalogue holds `key`: what a theme's `{{t "key"}}` is
// checked against when it is saved.
export const hasMessage = (key: string): boolean => Object.hasOwn(en, key);

export const fillPage = createPageFiller({
  defaults: DEFAULT_TEMPLATES,
  hasMessage,
  // Checked by `hasMessage` first, so the key is one of the catalogue's.
  text: (locale, key) => t(locale, key as MessageId),
});
