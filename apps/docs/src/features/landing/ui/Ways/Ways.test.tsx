import { describe, expect, it } from 'vitest';
import {
  EXAMPLES,
  EXAMPLES_URL_PATH,
  READERS,
  WORDPRESS,
} from '@site/src/features/landing/services/capabilityCards';
import { PAGES_DOCS_BASE } from '@site/site.config';
import { Ways } from '@site/src/features/landing/ui/Ways/Ways';
import { markupOf } from '@site/tests/support/markup';

const PROPS = {
  readers: READERS,
  examples: { cards: EXAMPLES, wordpress: WORDPRESS, sourcePath: EXAMPLES_URL_PATH },
};

describe('Ways', () => {
  it('offers four ways in and four examples, each with its guide', () => {
    const $ = markupOf(<Ways {...PROPS} />);
    expect($('[data-section="readers"]')).toHaveLength(1);
    expect($('[data-section="examples"] li')).toHaveLength(4);
    expect($(`[data-section="examples"] li a[href^="${PAGES_DOCS_BASE}guides/"]`)).toHaveLength(4);
  });

  it('adds one plain line for the hand-tested WordPress guide, with no logo or claim of support', () => {
    const $ = markupOf(<Ways {...PROPS} />);
    const line = $('[data-example="wordpress"]');
    expect(line.text()).toBe('Also a hand-tested guide: sign in to WordPress.');
    expect(line.find('a').attr('href')).toBe(`${PAGES_DOCS_BASE}guides/wordpress/`);
    expect(line.find('img, svg')).toHaveLength(0);
    expect($('[data-section="examples"]').text()).not.toMatch(
      /supports|supported|endorse|trademark|affiliated/iu,
    );
  });

  it('opens the examples folder in a new tab, safely, and says so', () => {
    const $ = markupOf(<Ways {...PROPS} />);
    const link = $('a[target="_blank"]');
    expect(link.attr('rel')).toBe('noopener noreferrer');
    expect(link.text()).toContain('(opens in a new tab)');
  });
});
