import { describe, expect, it } from 'vitest';
import { ConsoleShot } from '@site/src/shared/ui/ConsoleShot';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_BASE } from '@site/site.config';

describe('ConsoleShot', () => {
  it('shows both captures at their captured size, with the caption beneath', () => {
    const $ = markupOf(<ConsoleShot name="overview" alt="The overview." caption="A tenant." />);
    const sources = $('img')
      .map((_, image) => $(image).attr('src'))
      .get();
    expect(sources).toEqual([
      `${PAGES_BASE}console/overview-light.webp`,
      `${PAGES_BASE}console/overview-dark.webp`,
    ]);
    expect($('img').first().attr('width')).toBe('1100');
    expect($('figcaption').text()).toBe('A tenant.');
  });

  it('fetches a priority picture first and the others lazily', () => {
    const lazy = markupOf(<ConsoleShot name="overview" alt="a" caption="c" />);
    expect(lazy('img').first().attr('loading')).toBe('lazy');
    const first = markupOf(<ConsoleShot name="overview" alt="a" caption="c" priority />);
    expect(first('img').first().attr('fetchpriority')).toBe('high');
    expect(first('img').last().attr('loading')).toBe('lazy');
  });

  it('refuses a capture the manifest does not know', () => {
    expect(() => markupOf(<ConsoleShot name="no-such-page" alt="a" caption="c" />)).toThrow(
      'no console capture named no-such-page',
    );
  });
});
