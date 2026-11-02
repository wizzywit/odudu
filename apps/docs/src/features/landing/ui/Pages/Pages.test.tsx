import { describe, expect, it } from 'vitest';
import { PAGES_DOCS_BASE } from '@site/site.config';
import { Pages } from '@site/src/features/landing/ui/Pages/Pages';
import { markupOf } from '@site/tests/support/markup';

describe('Pages', () => {
  it('is headed as the pages your users see and holds the strip', () => {
    const $ = markupOf(<Pages />);
    expect($('section[data-section="pages"] h2').text()).toBe('The pages your users see');
    expect($('[data-strip] figure')).toHaveLength(4);
    expect($('[data-planned]')).toHaveLength(0);
  });

  it('links the sign-in guide from its lede', () => {
    const $ = markupOf(<Pages />);
    expect($('p a').first().attr('href')).toBe(`${PAGES_DOCS_BASE}guides/sign-a-user-in/`);
  });
});
