import { describe, expect, it } from 'vitest';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import { markupOf } from '@site/tests/support/markup';

describe('Section', () => {
  it('labels the band by its heading and carries its marker', () => {
    const $ = markupOf(
      <Section id="home-x" kicker="Kicker" title="A title" section="x">
        <p>content</p>
      </Section>,
    );
    expect($('section').attr('aria-labelledby')).toBe('home-x');
    expect($('section').attr('data-section')).toBe('x');
    expect($('h2#home-x').text()).toBe('A title');
    expect($('p').first().text()).toBe('Kicker');
    expect($('p').last().text()).toBe('content');
  });

  it('marks the heading to travel further than the rest', () => {
    const $ = markupOf(
      <Section id="a" kicker="k" title="t">
        x
      </Section>,
    );
    expect($('[data-reveal="heading"]')).toHaveLength(1);
  });
});
