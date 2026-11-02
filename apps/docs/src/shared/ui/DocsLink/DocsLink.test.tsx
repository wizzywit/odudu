import { describe, expect, it } from 'vitest';
import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('DocsLink', () => {
  it('links a documentation route under the docs directory of the build', () => {
    const $ = markupOf(<DocsLink to="/roadmap/#next">Roadmap</DocsLink>);
    expect($('a').attr('href')).toBe(`${PAGES_DOCS_BASE}roadmap/#next`);
    expect($('a').text()).toBe('Roadmap');
  });
});
