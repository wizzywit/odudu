import { describe, expect, it } from 'vitest';
import { DocsHome } from '@site/src/features/docs-home/ui/DocsHome/DocsHome';
import { markupOf } from '@site/tests/support/markup';

describe('DocsHome', () => {
  it('is the documentation home of an installation, with no landing', () => {
    const $ = markupOf(<DocsHome audience="installation" />);
    expect($('main[data-page="docs-home"]')).toHaveLength(1);
    expect($('h1').text()).toBe('Documentation');
    expect($('p').first().text()).toContain('you are running');
    expect($('[data-page="landing"]')).toHaveLength(0);
  });

  it('is the same page on the public site without claiming to be an installation', () => {
    const $ = markupOf(<DocsHome audience="public" />);
    expect($('main[data-page="docs-home"]')).toHaveLength(1);
    expect($('p').first().text()).not.toContain('you are running');
  });
});
