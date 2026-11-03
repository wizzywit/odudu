import { describe, expect, it } from 'vitest';
import { STEPS } from '@site/src/features/landing/services/startSteps';
import { Steps } from '@site/src/features/landing/ui/Steps/Steps';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('Steps', () => {
  it('names the three steps in order and links the quick start', () => {
    const $ = markupOf(<Steps steps={STEPS} />);
    expect($('h2').text()).toBe('From docker compose up to your first sign-in');
    expect(
      $('ol li h3')
        .map((_, heading) => $(heading).text())
        .get(),
    ).toEqual(STEPS.map((step) => step.title));
    expect($('a').attr('href')).toBe(`${PAGES_DOCS_BASE}quick-start/`);
  });
});
