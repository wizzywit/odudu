import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';

export function renderUnthemed(locale: PageLocale): RenderedPage {
  return page('Title', '<h1>Hello</h1>', null, [], locale);
}
