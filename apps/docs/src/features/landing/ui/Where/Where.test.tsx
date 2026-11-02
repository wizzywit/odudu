import { describe, expect, it } from 'vitest';
import { Where } from '@site/src/features/landing/ui/Where/Where';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('Where', () => {
  it('presents the hosted service as in the works, linking only the roadmap', () => {
    const $ = markupOf(<Where />);
    const hosted = $('[data-section="hosted"]');
    expect(hosted.text()).toContain('in the works');
    expect(
      hosted
        .find('a')
        .map((_, link) => $(link).attr('href'))
        .get(),
    ).toEqual([`${PAGES_DOCS_BASE}roadmap/`]);
    expect(hosted.find('form, input, button')).toHaveLength(0);
  });

  it('names the licences and publishes the font licence texts', () => {
    const $ = markupOf(<Where />);
    const licence = $('[data-section="licence"]');
    expect(licence.text()).toContain('AGPL-3.0');
    expect(licence.text()).toContain('Apache-2.0');
    expect(licence.find('a[href$=".txt"]')).toHaveLength(2);
  });
});
