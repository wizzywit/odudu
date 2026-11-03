import { describe, expect, it } from 'vitest';
import { JOURNEYS, SECTIONS } from '@site/nav';
import { homeMapSections } from '@site/src/features/docs-home/services/homeMap';
import { HomeMap } from '@site/src/features/docs-home/ui/HomeMap/HomeMap';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('HomeMap', () => {
  it('links every section once, and every journey, under three headings', () => {
    const $ = markupOf(<HomeMap sections={homeMapSections()} />);
    expect($('h2')).toHaveLength(3);
    const hrefs = $('a')
      .map((_, link) => $(link).attr('href'))
      .get();
    for (const section of SECTIONS) expect(hrefs).toContain(`${PAGES_DOCS_BASE}${section.route}`);
    for (const journey of JOURNEYS) expect(hrefs).toContain(`${PAGES_DOCS_BASE}${journey.route}`);
  });
});
