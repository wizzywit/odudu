import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';
import { fillPage } from '#/view/template';

export function renderFillsElsewhere(locale: PageLocale): RenderedPage {
  const unused = fillPage('notice', { message: '<h1>Hi</h1>' }, locale);
  return page(unused.length > 0 ? 'Title' : 'Other', '<h1>Hello</h1>', null, [], locale);
}
