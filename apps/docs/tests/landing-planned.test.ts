import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES_DOCS_BASE } from '#docs/site.config.ts';
import { AGENT_ITEMS, type Planned } from '#docs/src/features/landing/service/content.ts';
import { DOCS_ROOT, distDir, load } from '#docs/tests/support/dist.ts';

// A "Planned" claim on the landing page is held to the roadmap's words: each
// phrase it quotes must still be in a Next or Later line, and must still be
// said on the page, so a changed or removed roadmap line fails the build.

const normal = (text: string): string =>
  text.replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').toLowerCase();

const roadmap = readFileSync(path.join(DOCS_ROOT, 'content/en/roadmap.md'), 'utf8');
const ahead = normal(
  roadmap.slice(roadmap.indexOf('## Next'), roadmap.indexOf('## Decided against')),
);
const $ = load(path.join(distDir('pages'), 'index.html'));
const landing = $('[data-page="landing"]');

const PLANNED: Planned[] = [...AGENT_ITEMS];

describe('every Planned claim on the landing page', () => {
  it('is on the page once, with the chip "Planned", and every item on the page is known', () => {
    const onPage = landing
      .find('[data-planned]')
      .map((_, element) => $(element).attr('data-planned') ?? '')
      .get();
    expect(onPage.sort()).toEqual(PLANNED.map((item) => item.id).sort());
    landing.find('[data-planned]').each((_, element) => {
      expect($(element).find('[data-chip]').text()).toBe('Planned');
    });
  });

  it.each(PLANNED)('$id says what the roadmap says', (item) => {
    const said = normal(landing.find(`[data-planned="${item.id}"]`).text());
    expect(item.quotes.length).toBeGreaterThan(0);
    for (const quote of item.quotes) {
      expect(ahead, `the roadmap no longer says "${quote}"`).toContain(normal(quote));
      expect(said, `the landing page no longer says "${quote}"`).toContain(normal(quote));
    }
  });

  it.each(PLANNED)('$id links the roadmap page, and the section it names exists', (item) => {
    const hrefs = landing
      .find(`[data-planned="${item.id}"] a`)
      .map((_, element) => $(element).attr('href'))
      .get();
    expect(hrefs).toEqual([`${PAGES_DOCS_BASE}roadmap/#next`]);
    expect(roadmap).toMatch(/^## Next$/mu);
  });

  it('names no phase, no date and nothing that sounds like a promise of timing', () => {
    const text = landing
      .find('[data-section="agents"], [data-section="pages"], [data-section="branding"]')
      .text();
    expect(text).not.toMatch(
      /\bP\d+[a-z]?\b|coming soon|\bsoon\b|\b20\d\d\b|\bnext (week|month|quarter|year)\b/iu,
    );
  });

  it('keeps Hosted Odudu to "in the works", with no date or price', () => {
    const hosted = landing.find('[data-section="hosted"]').text();
    expect(hosted).toContain('in the works');
    expect(hosted).not.toMatch(/[$€£¥]|\b20\d\d\b|pricing/iu);
  });
});

describe('the branding band, which shipped', () => {
  it('is on the landing page and carries no Planned marker', () => {
    const band = landing.find('[data-section="branding"]');
    expect(band).toHaveLength(1);
    expect(band.find('[data-planned], [data-chip], [data-today]')).toHaveLength(0);
    expect(band.text()).not.toMatch(/planned/iu);
  });
});

describe('a Planned claim is short', () => {
  it.each(AGENT_ITEMS)('$id is at most 25 words', (item) => {
    expect(item.claim.split(/\s+/u).length).toBeLessThanOrEqual(25);
  });
});
