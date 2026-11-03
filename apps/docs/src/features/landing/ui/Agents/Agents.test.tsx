import { describe, expect, it } from 'vitest';
import { PLANNED_LABEL, ROADMAP_NEXT } from '@site/src/features/landing/services/plannedClaims';
import { PAGES_DOCS_BASE } from '@site/site.config';
import { AGENT_ITEMS } from '@site/src/features/landing/services/plannedClaims';
import { Agents } from '@site/src/features/landing/ui/Agents/Agents';
import { markupOf } from '@site/tests/support/markup';

const PROPS = {
  agents: { items: AGENT_ITEMS, plannedLabel: PLANNED_LABEL, roadmapPath: ROADMAP_NEXT },
};

describe('Agents', () => {
  it('holds only what is planned: two items and nothing that already works', () => {
    const $ = markupOf(<Agents {...PROPS} />);
    expect($('[data-planned]')).toHaveLength(2);
    expect($('[data-shipped]')).toHaveLength(0);
    expect($('a[href$="llms.txt"]')).toHaveLength(0);
    expect($('[data-chip]').filter((_, chip) => $(chip).text() !== 'Planned')).toHaveLength(0);
  });

  it('labels each planned item Planned and links it to the roadmap', () => {
    const $ = markupOf(<Agents {...PROPS} />);
    const planned = $('[data-planned]');
    expect(planned).toHaveLength(AGENT_ITEMS.length);
    planned.each((_, element) => {
      const item = $(element);
      expect(item.find('[data-chip]').text()).toBe('Planned');
      expect(item.find(`a[href="${PAGES_DOCS_BASE}roadmap/#next"]`)).toHaveLength(1);
      expect(item.text()).toContain(
        AGENT_ITEMS.find((i) => i.id === item.attr('data-planned'))?.claim,
      );
    });
  });

  it('heads the band as what is planned', () => {
    const $ = markupOf(<Agents {...PROPS} />);
    expect($('h2').text()).toMatch(/planned/iu);
  });

  it('names no phase, no date and no "coming soon"', () => {
    const $ = markupOf(<Agents {...PROPS} />);
    expect($.text()).not.toMatch(/\bP\d+[a-z]?\b|coming soon|\b20\d\d\b|\bsoon\b/iu);
  });
});
