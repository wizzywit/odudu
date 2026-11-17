import { describe, expect, it } from 'vitest';
import { renderEmailConfirmPage } from '#/view/verification-html';
import { renderRegistrationForm } from '#/view/registration-html';
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

  it.each([
    ['required', 'اسم المستخدم', 4, 0],
    ['optional', 'اسم المستخدم', 3, 1],
    ['generated', 'البريد الإلكتروني', 3, 0],
  ] as const)(
    'the registration form says its %s markers in Arabic',
    (usernameMode, label, required, optional) => {
      const { body } = renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        {
          rules: {
            minLength: 12,
            requireDigit: false,
            requireUppercase: false,
            requireLowercase: false,
            requireSpecial: false,
          },
          usernameMode,
        },
        ARABIC,
      );
      expect(body).toContain(label);
      expect(body.split('marker-required">(مطلوب)</span>')).toHaveLength(required + 1);
      expect(body.split('marker-optional">(اختياري)</span>')).toHaveLength(optional + 1);
    },
  );
});
