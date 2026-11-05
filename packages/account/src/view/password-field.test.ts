import { DEFAULT_PAGE_LOCALE, pageHeaders, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { renderRegistrationForm } from '#/view/registration-html';
import { renderResetPasswordForm } from '#/view/reset-html';
import { renderRequiredActionsForm } from '#/view/required-actions-html';

const NONE = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};
const ALL = {
  minLength: 20,
  requireDigit: true,
  requireUppercase: true,
  requireLowercase: true,
  requireSpecial: true,
};

const withoutScript = (body: string): string =>
  body.replace(/<script nonce="[^"]*">[\s\S]*?<\/script>/u, '');
const hintLines = (body: string): (string | undefined)[] =>
  [...body.matchAll(/<li[^>]*>([^<]*)<\/li>/gu)].map((match) => match[1]);

const pages = {
  registration: (rules: typeof NONE) =>
    renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules },
      DEFAULT_PAGE_LOCALE,
    ),
  reset: (rules: typeof NONE) =>
    renderResetPasswordForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'k',
      undefined,
      rules,
      DEFAULT_PAGE_LOCALE,
    ),
  actions: (rules: typeof NONE) =>
    renderRequiredActionsForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'k',
      ['update-password'],
      true,
      undefined,
      rules,
      DEFAULT_PAGE_LOCALE,
    ),
};

describe.each(Object.entries(pages))('the password hints on the %s page', (name, render) => {
  it('lists the tenant length and every rule it enables, as plain markup', () => {
    expect(hintLines(render(ALL).body).slice(-6)).toEqual([
      'At least 20 characters',
      'A digit',
      'An uppercase letter',
      'A lowercase letter',
      'A special character',
      'Not a common password',
    ]);
    expect(render(ALL).body).toContain('minlength="20"');
  });

  it('lists no character rule the tenant has not enabled', () => {
    expect(withoutScript(render(NONE).body)).not.toMatch(
      /digit|uppercase|lowercase|special character/iu,
    );
  });

  it('declares the scripts it carries under one nonce, and no request', () => {
    const page = render(NONE);
    const nonce = page.script?.nonce ?? '';
    const policy = pageHeaders(page).find(([name]) => name === 'content-security-policy')?.[1];
    expect(policy).toContain(`script-src 'nonce-${nonce}'`);
    expect(policy).not.toContain('connect-src');
    // The hints script, and on the registration page the one that shows the
    // confirmation with the password.
    expect(page.html.match(/<script nonce="[^"]*"/gu)).toEqual(
      Array.from({ length: name === 'registration' ? 2 : 1 }, () => `<script nonce="${nonce}"`),
    );
  });
});
