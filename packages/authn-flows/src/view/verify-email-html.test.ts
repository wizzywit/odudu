import { DEFAULT_PAGE_LOCALE, pageHeaders, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { en } from '#/view/messages';
import { ar } from '#/view/messages.ar';
import { renderRequestedVerifyEmailPage, renderVerifyEmailPage } from '#/view/verify-email-html';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const OFFER = { email: 'ada@example.com', verified: false };

function page(notice?: Parameters<typeof renderVerifyEmailPage>[4]): string {
  return renderVerifyEmailPage('acme', ADDRESS, 'sess-1', OFFER, notice, DEFAULT_PAGE_LOCALE).html;
}

describe('the verify-email page', () => {
  it('posts to the required-action step for this action, bound to the sign-in', () => {
    const html = page();
    expect(html).toContain(
      'action="/tenants/acme/login-actions/required-action?action=verify-email"',
    );
    expect(html).toContain('<input type="hidden" name="auth_session_id" value="sess-1">');
  });

  it('shows the address held, isolated, and both ways forward', () => {
    const html = page();
    expect(html).toContain('<bdi>ada@example.com</bdi>');
    expect(html).toContain('name="send"');
    expect(html).toContain(en['verifyEmail.confirm']);
  });

  it('escapes an address that is hostile markup', () => {
    const html = renderVerifyEmailPage(
      'acme',
      ADDRESS,
      'sess-1',
      { email: '<script>x</script>@example.com', verified: false },
      undefined,
      DEFAULT_PAGE_LOCALE,
    ).html;
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;@example.com');
  });

  it.each([
    ['sent', 'verifyEmail.sent'],
    ['limited', 'verifyEmail.limited'],
    ['unavailable', 'verifyEmail.unavailable'],
  ] as const)('says a %s link in its own words', (notice, message) => {
    expect(page(notice)).toContain(en[message].replace(/"/gu, '&quot;'));
  });

  it('refuses in the error slot when the address is still not verified', () => {
    const html = page('not_verified');
    expect(html).toContain('role="alert"');
    expect(html).toContain(en['verifyEmail.notVerified']);
  });

  it('offers only the way on for an address that is already verified', () => {
    const html = renderVerifyEmailPage(
      'acme',
      ADDRESS,
      'sess-1',
      { email: 'ada@example.com', verified: true },
      undefined,
      DEFAULT_PAGE_LOCALE,
    ).html;
    expect(html).toContain(en['verifyEmail.alreadyVerified']);
    expect(html).not.toContain('name="send"');
  });

  it('has no way out when the tenant owes it, and one when an application asked', () => {
    expect(page()).not.toContain('name="cancel"');
    const requested = renderRequestedVerifyEmailPage(
      'acme',
      ADDRESS,
      'sess-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    ).html;
    expect(requested).toContain('name="cancel"');
    expect(requested).toContain(en['verifyEmail.requestedIntro']);
  });

  it('sends its headers through pageHeaders and needs no script', () => {
    const rendered = renderVerifyEmailPage(
      'acme',
      ADDRESS,
      'sess-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(rendered.script).toBeNull();
    const policy = pageHeaders(rendered).find(([name]) => name === 'content-security-policy');
    expect(policy?.[1]).toContain("default-src 'none'");
    expect(policy?.[1]).not.toContain('script-src');
  });

  it('has an Arabic twin for every sentence it uses', () => {
    for (const key of Object.keys(en).filter((each) => each.startsWith('verifyEmail.'))) {
      expect(Object.hasOwn(ar, key), key).toBe(true);
    }
  });
});
