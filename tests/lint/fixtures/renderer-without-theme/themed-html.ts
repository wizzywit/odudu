import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';
import { fillPage } from '#/view/template';

export function renderDirect(locale: PageLocale): RenderedPage {
  return page('Title', fillPage('notice', { message: '<h1>Hi</h1>' }, locale), null, [], locale);
}

export function renderThroughAVariable(locale: PageLocale): RenderedPage {
  const body = fillPage('notice', { message: '<h1>Hi</h1>' }, locale);
  return { ...page('Title', body, null, [], locale) };
}
