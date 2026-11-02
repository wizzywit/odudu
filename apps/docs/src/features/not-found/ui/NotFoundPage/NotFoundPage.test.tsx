import { describe, expect, it } from 'vitest';
import { NotFoundPage } from '@site/src/features/not-found/ui/NotFoundPage/NotFoundPage';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_BASE, PAGES_DOCS_BASE } from '@site/site.config';

describe('NotFoundPage', () => {
  it('says what happened in one heading and one line', () => {
    const $ = markupOf(<NotFoundPage />);
    expect($('h1').text()).toBe('Page not found');
    expect($('main p')).toHaveLength(1);
    expect($('main[data-page="not-found"]')).toHaveLength(1);
  });

  it('carries the drawing, hidden from assistive technology, with no title or text', () => {
    const $ = markupOf(<NotFoundPage />);
    expect($('main svg[aria-hidden="true"]')).toHaveLength(1);
    expect($('main svg title, main svg text')).toHaveLength(0);
    expect($('main svg').attr('style')).toBeUndefined();
  });

  it('links the documentation home, the quick start and search', () => {
    const $ = markupOf(<NotFoundPage />);
    const links = $('a')
      .map((_, link) => ({ href: $(link).attr('href'), text: $(link).text() }))
      .get();
    expect(links).toEqual([
      { href: PAGES_DOCS_BASE, text: 'Go to the documentation home' },
      { href: `${PAGES_DOCS_BASE}quick-start/`, text: 'Follow the quick start' },
      { href: `${PAGES_BASE}search/`, text: 'Search the documentation' },
    ]);
  });
});
