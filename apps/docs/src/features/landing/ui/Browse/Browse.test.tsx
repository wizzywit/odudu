import { describe, expect, it } from 'vitest';
import { JOURNEYS, SECTIONS } from '@site/nav';
import { Browse } from '@site/src/features/landing/ui/Browse/Browse';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_BASE, PAGES_DOCS_BASE } from '@site/site.config';

describe('Browse', () => {
  it('links every section and every journey', () => {
    const $ = markupOf(<Browse />);
    const hrefs = $('a')
      .map((_, link) => $(link).attr('href'))
      .get();
    for (const section of SECTIONS) expect(hrefs).toContain(`${PAGES_DOCS_BASE}${section.route}`);
    for (const journey of JOURNEYS) expect(hrefs).toContain(`${PAGES_DOCS_BASE}${journey.route}`);
  });

  it('links the documentation home, which nothing else on the site links', () => {
    const $ = markupOf(<Browse />);
    expect($('a[data-docs-home]').attr('href')).toBe(PAGES_DOCS_BASE);
  });

  it('leaves what is built for AI agents to its own section', () => {
    const $ = markupOf(<Browse />);
    expect($('[data-section="agents"]')).toHaveLength(0);
  });

  it('says every page also comes as Markdown, in one line that links llms.txt', () => {
    const $ = markupOf(<Browse />);
    const line = $('[data-markdown]');
    expect(line).toHaveLength(1);
    expect(line.text()).toBe('Every page also comes as Markdown, and llms.txt lists them.');
    expect(line.find(`a[href="${PAGES_BASE}llms.txt"]`)).toHaveLength(1);
  });
});
