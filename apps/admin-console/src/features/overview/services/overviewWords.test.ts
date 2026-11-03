import { expect, it } from 'vitest';
import { OVERVIEW_WORDS, overviewTitle } from '#/features/overview/services/overviewWords';

it('titles the page as the menu entry that opens it', () => {
  expect(overviewTitle()).toBe('Overview');
});

it('says what a panel that could not read says, from the shared sentence', () => {
  expect(OVERVIEW_WORDS.discovery.failedTitle).toBe('The discovery document could not be read');
  expect(OVERVIEW_WORDS.discovery.keysFailedTitle).toBe('The JWKS could not be read');
});

it('leads the unchecked capabilities as the attention panel always did', () => {
  expect(OVERVIEW_WORDS.attention.uncheckedLead).toBe(
    'Some checks need a capability you do not hold: ',
  );
});
