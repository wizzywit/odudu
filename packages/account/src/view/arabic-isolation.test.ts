import { describe, expect, it } from 'vitest';
import { renderEmailConfirmPage } from '#/view/verification-html';
import { ARABIC } from '@odudu/testkit/i18n';

describe('a page in Arabic isolates what somebody else wrote', () => {
  it('the account name on the confirmation page', () => {
    const page = renderEmailConfirmPage('acme', 'key', 'evil<b>_user & "co"', ARABIC);
    expect(page.body).toContain('اسم الحساب: <bdi>evil&lt;b&gt;_user &amp; &quot;co&quot;</bdi>');
  });
});
