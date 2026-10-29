import { describe, expect, it } from 'vitest';
import { PAGES_BASE, PAGES_DOCS_BASE } from '@site/site.config';
import { BRANDING } from '@site/src/features/landing/service/content';
import { Branding } from '@site/src/features/landing/view/Branding/Branding';
import { markupOf } from '@site/tests/support/markup';

describe('Branding', () => {
  it('is a band of its own, with its text beside one framed picture', () => {
    const $ = markupOf(<Branding />);
    const band = $('section[data-section="branding"]');
    expect(band).toHaveLength(1);
    expect(band.find('h2').text()).toBe(BRANDING.title);
        expect(band.find('[data-aside] [data-frame="look"]')).toHaveLength(1);
    expect(band.find('[data-aside] fieldset')).toHaveLength(0);
    expect(band.find('fieldset')).toHaveLength(1);
  });

  it('is shipped, not planned: no chip, no roadmap link, no phase name', () => {
    const $ = markupOf(<Branding />);
    const band = $('section[data-section="branding"]');
    expect(band.find('[data-chip]')).toHaveLength(0);
    expect(band.find('[data-planned], [data-today]')).toHaveLength(0);
    expect(band.find(`a[href="${PAGES_DOCS_BASE}roadmap/#next"]`)).toHaveLength(0);
    expect(band.text()).toContain(BRANDING.claim);
    expect(band.text()).not.toMatch(/\bP\d+[a-z]?\b|coming soon|planned|\bwill\b|today/iu);
  });

  it('links the branding guide in the console pages', () => {
    const $ = markupOf(<Branding />);
    expect($('section[data-section="branding"] a').attr('href')).toBe(
      `${PAGES_DOCS_BASE}admin-console/branding/`,
    );
  });

  it('swaps two looks of the same page with a labelled control that needs no script', () => {
    const $ = markupOf(<Branding />);
    const group = $('fieldset');
    expect(group).toHaveLength(1);
    expect(group.find('legend').text()).toBe(BRANDING.legend);
    const choices = group.find('input[type="radio"]');
    expect(choices).toHaveLength(2);
    expect(choices.filter('[checked]')).toHaveLength(1);
    expect($('script')).toHaveLength(0);
    const sources = $('img')
      .map((_, image) => $(image).attr('src'))
      .get();
    expect(sources).toEqual([
      `${PAGES_BASE}server-pages/look-odudu-light.webp`,
      `${PAGES_BASE}server-pages/look-odudu-dark.webp`,
      `${PAGES_BASE}server-pages/look-other-light.webp`,
      `${PAGES_BASE}server-pages/look-other-dark.webp`,
    ]);
    $('img').each((_, element) => {
      expect($(element).attr('loading')).toBe('lazy');
      expect($(element).attr('width')).toBe('460');
    });
  });

  it('says the pictures once: in the legend, with a short caption', () => {
    const $ = markupOf(<Branding />);
    expect($('legend').text()).toBe(BRANDING.legend);
    expect($('legend').text()).not.toMatch(/planned|illustration/iu);
    expect($('figcaption').text()).toBe(BRANDING.caption);
  });

  it('shows two real looks with alt text', () => {
    const $ = markupOf(<Branding />);
    const alts = $('img')
      .map((_, image) => $(image).attr('alt') ?? '')
      .get();
    expect(alts).toEqual([
      BRANDING.alt.odudu,
      BRANDING.alt.odudu,
      BRANDING.alt.other,
      BRANDING.alt.other,
    ]);
    expect(BRANDING.alt.odudu).not.toBe(BRANDING.alt.other);
    for (const alt of Object.values(BRANDING.alt)) expect(alt.length).toBeGreaterThan(40);
    expect(BRANDING.alt.other).toMatch(/tenant/iu);
    expect($('label').text()).toContain("A tenant's theme");
  });
});
