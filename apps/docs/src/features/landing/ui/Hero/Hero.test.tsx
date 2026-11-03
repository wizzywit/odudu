import { describe, expect, it } from 'vitest';
import { Hero } from '@site/src/features/landing/ui/Hero/Hero';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('Hero', () => {
  it('says what Odudu is in one headline and offers the docs and the quick start', () => {
    const $ = markupOf(<Hero />);
    expect($('h1').text()).toBe('An identity provider you run yourself');
    expect(
      $('a')
        .map((_, link) => $(link).attr('href'))
        .get(),
    ).toEqual([
      `${PAGES_DOCS_BASE}introduction/`,
      `${PAGES_DOCS_BASE}quick-start/`,
      `${PAGES_DOCS_BASE}roadmap/`,
    ]);
  });

  it('shows the console in a picture that is fetched first and never lazily', () => {
    const $ = markupOf(<Hero />);
    const first = $('img').first();
    expect(first.attr('fetchpriority')).toBe('high');
    expect(first.attr('loading')).toBeUndefined();
  });

  it('holds the one command', () => {
    const $ = markupOf(<Hero />);
    expect($('code[data-shell="unix"]').text()).toContain('docker compose up -d');
  });
});
