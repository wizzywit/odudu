import { expect, it } from 'vitest';
import {
  revokeLabel,
  TOKEN_WORDS,
  tokensArea,
  TOKENS_RULE,
} from '#/features/registration-tokens/services/tokenWording';

it('says where the history of a spent token is', () => {
  expect(TOKENS_RULE).toContain('Audit trail');
});

it('labels the revoke of a token by its id', () => {
  expect(revokeLabel('t-one')).toBe('Revoke t-one');
});

it('names the page as the console’s rail does, and counts tokens as the list does', () => {
  expect(tokensArea().title).toBe('Registration tokens');
  expect(TOKEN_WORDS.noun).toEqual({ one: 'registration token', other: 'registration tokens' });
  expect(TOKEN_WORDS.mint.submit).toBe('Mint token');
});
