import { describe, expect, it } from 'vitest';
import { renderEmailConfirmPage } from '#/view/verification-html';
import { ARABIC } from '@odudu/testkit/i18n';
import { pathAddress } from '@odudu/kernel';

describe('a page in Arabic isolates what somebody else wrote', () => {
  it('the account name on the confirmation page', () => {
    const page = renderEmailConfirmPage(
      pathAddress('https://idp.example', 'acme'),
      'key',
      { username: 'evil<b>_user & "co"', email: null, tenant: 'acme' },
      ARABIC,
    );
    expect(page.body).toContain('اسم الحساب: <bdi>evil&lt;b&gt;_user &amp; &quot;co&quot;</bdi>');
  });
});
