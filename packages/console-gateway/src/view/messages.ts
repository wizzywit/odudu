import { createTranslators, type Messages, type Translators } from '@odudu/i18n';
import { escapeHtml } from '#/view/document';
import { ar } from '#/view/messages.ar';

// Every sentence a console-gateway page shows, keyed by what it is for. `en`
// is the source and complete; another locale may omit a key and shows English
// for it. A message is plain text: markup stays in the renderer.
export const en = {
  'refusal.title': 'Sign-in failed',
  'refusal.reason': 'The sign-in could not be completed.',
  'refusal.again': 'Sign in again',
};

export { ar };
export type MessageId = keyof typeof en;

export function translators(byLocale: Messages<typeof en>): Translators<typeof en> {
  return createTranslators(byLocale, escapeHtml);
}

const shipped = translators({ en, ar });

export const catalogue = shipped.catalogue;
export const t = shipped.t;
export const tHtml = shipped.tHtml;
export const bdi = shipped.bdi;
