import { describe, expect, it } from 'vitest';
import { Compare } from '@site/src/features/landing/ui/Compare/Compare';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('Compare', () => {
  it('says plainly that it is a release candidate', () => {
    const $ = markupOf(<Compare />);
    expect($('strong').text()).toBe('Odudu is a release candidate.');
  });

  it('links the comparison, the Keycloak guide and the roadmap', () => {
    const $ = markupOf(<Compare />);
    expect(
      $('a')
        .map((_, link) => $(link).attr('href'))
        .get(),
    ).toEqual([
      `${PAGES_DOCS_BASE}introduction/compare/`,
      `${PAGES_DOCS_BASE}guides/keycloak/`,
      `${PAGES_DOCS_BASE}roadmap/`,
    ]);
  });
});
