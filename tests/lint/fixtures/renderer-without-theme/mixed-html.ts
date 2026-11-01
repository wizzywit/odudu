import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';
import { fillPage } from '#/view/template';

export function renderThemed(locale: PageLocale): RenderedPage {
  return page('Title', fillPage('notice', { message: '<h1>Hi</h1>' }, locale), null, [], locale);
}

export function renderNot(locale: PageLocale): RenderedPage {
  return page('Title', '<h1>Hello</h1>', null, [], locale);
}
