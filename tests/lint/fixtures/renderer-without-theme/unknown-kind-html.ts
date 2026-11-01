import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';
import { fillPage } from '#/view/template';

export function renderUnknownKind(locale: PageLocale): RenderedPage {
  return page('Title', fillPage('no-such-kind', { message: '' }, locale), null, [], locale);
}
