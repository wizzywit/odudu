import { expect, it } from 'vitest';
import { tokensHref, TOKENS_RULE } from '#/features/registration-tokens/services/page';

it('addresses the area under the tenant, escaped', () => {
  expect(tokensHref('acme')).toBe('/console/acme/registration-tokens');
  expect(tokensHref('a b')).toBe('/console/a%20b/registration-tokens');
});

it('says where the history of a spent token is', () => {
  expect(TOKENS_RULE).toContain('Audit trail');
});
