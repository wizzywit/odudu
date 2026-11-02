import { expect, it } from 'vitest';
import { TOKENS_RULE } from '#/features/registration-tokens/services/page';

it('says where the history of a spent token is', () => {
  expect(TOKENS_RULE).toContain('Audit trail');
});
