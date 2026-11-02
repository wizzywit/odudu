import { describe, expect, it } from 'vitest';
import type { Card } from '@site/src/features/landing/services/content';
import { CardList } from '@site/src/features/landing/ui/CardList/CardList';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

const CARDS: Card[] = [
  { title: 'One', body: 'First card.', to: '/a/' },
  { title: 'Two', body: 'Second card.', to: '/b/' },
];

describe('CardList', () => {
  it('lists each card once, its title the one link to its page', () => {
    const $ = markupOf(<CardList cards={CARDS} columns={4} />);
    expect($('li')).toHaveLength(2);
    expect(
      $('li a')
        .map((_, link) => $(link).attr('href'))
        .get(),
    ).toEqual([`${PAGES_DOCS_BASE}a/`, `${PAGES_DOCS_BASE}b/`]);
    expect($('li').first().find('p').text()).toBe('First card.');
  });

  it('marks every card to be revealed as it comes into view', () => {
    const $ = markupOf(<CardList cards={CARDS} columns={2} />);
    expect($('li[data-reveal]')).toHaveLength(2);
  });
});
