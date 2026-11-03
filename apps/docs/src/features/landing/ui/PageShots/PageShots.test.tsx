import { describe, expect, it } from 'vitest';
import { PAGES_BASE } from '@site/site.config';
import { PAGE_SHOTS } from '@site/src/features/landing/services/serverPageCards';
import { PageShots } from '@site/src/features/landing/ui/PageShots/PageShots';
import { markupOf } from '@site/tests/support/markup';

describe('PageShots', () => {
  it('shows the four pages, each in a light and a dark capture', () => {
    const $ = markupOf(<PageShots />);
    expect(PAGE_SHOTS.map((shot) => shot.name)).toEqual([
      'sign-in',
      'create-account',
      'reset-password',
      'second-factor',
    ]);
    expect($('figure')).toHaveLength(4);
    const sources = $('img')
      .map((_, image) => $(image).attr('src'))
      .get();
    expect(sources).toEqual(
      PAGE_SHOTS.flatMap((shot) => [
        `${PAGES_BASE}server-pages/${shot.name}-light.webp`,
        `${PAGES_BASE}server-pages/${shot.name}-dark.webp`,
      ]),
    );
  });

  it('puts the sign-in and create-account pages large, the other two small', () => {
    const $ = markupOf(<PageShots />);
    const named = (row: string): string[] =>
      $(`[data-row="${row}"] figcaption [data-caption]`)
        .map((_, caption) => $(caption).text())
        .get();
    expect(named('large')).toEqual(['Sign in', 'Create an account']);
    expect(named('small')).toEqual(['Reset a password', 'Second factor']);
    expect($('[data-row="large"] [data-frame="large"]')).toHaveLength(2);
    expect($('[data-row="small"] [data-frame="small"]')).toHaveLength(2);
  });

  it('says in a sentence what each small page is for', () => {
    const $ = markupOf(<PageShots />);
    const notes = $('[data-row="small"] [data-note]')
      .map((_, note) => $(note).text())
      .get();
    expect(notes).toEqual(
      PAGE_SHOTS.filter((shot) => shot.size === 'small').map((shot) => shot.note),
    );
    for (const note of notes) expect(note.length).toBeGreaterThan(20);
  });

  it('sizes every picture, describes it and fetches it lazily', () => {
    const $ = markupOf(<PageShots />);
    $('img').each((_, element) => {
      const image = $(element);
      expect(image.attr('width'), image.attr('src')).toBeDefined();
      expect(image.attr('height'), image.attr('src')).toBeDefined();
      expect(image.attr('alt')?.length ?? 0).toBeGreaterThan(20);
      expect(image.attr('loading')).toBe('lazy');
    });
  });

  it('captions each page with its name', () => {
    const $ = markupOf(<PageShots />);
    expect(
      $('[data-caption]')
        .map((_, caption) => $(caption).text())
        .get(),
    ).toEqual(PAGE_SHOTS.map((shot) => shot.caption));
  });
});
