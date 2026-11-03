import { expect, it } from 'vitest';
import { mailBrandingKey } from '#/pages/branding/repository/queryKeys';

it('names the mail branding by the published version and the client, the tenant when none', () => {
  expect(mailBrandingKey('acme', 3)).toEqual(['mail-branding', 'acme', 3, '']);
  expect(mailBrandingKey('acme', 3, 'c1')).toEqual(['mail-branding', 'acme', 3, 'c1']);
});
