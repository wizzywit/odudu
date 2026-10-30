import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { page } from '#/view/document';

// import { fillPage } from '#/view/template';
// return page('Title', fillPage('notice', {}, locale), null, [], locale);
const NOTE = "fillPage('notice'";

export function renderCommented(locale: PageLocale): RenderedPage {
  return page(NOTE, '<h1>Hello</h1>', null, [], locale);
}
