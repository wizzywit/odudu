import { DEFAULT_PAGE_LOCALE } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { renderPreviousAddressPage } from '#/view/previous-address-html';
import { ARABIC } from '@odudu/testkit/i18n';

const CANONICAL = 'https://login.acme.example';

describe('renderPreviousAddressPage', () => {
  it('keeps the English markup exactly, naming the address to use', () => {
    expect(renderPreviousAddressPage(CANONICAL, DEFAULT_PAGE_LOCALE).body).toBe(
      `<h1>This address has moved</h1>
<p>Sign-in is no longer offered at this address. Continue at the new address instead:</p>
<p><a href="https://login.acme.example"><bdi>https://login.acme.example</bdi></a></p>`,
    );
  });

  it('is a whole document with a title, no script and no form', () => {
    const page = renderPreviousAddressPage(CANONICAL, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('This address has moved');
    expect(page.html).toContain('<!doctype html>');
    expect(page.script).toBeNull();
    expect(page.body).not.toMatch(/<(script|form)\b/u);
  });

  it('escapes the address once', () => {
    const body = renderPreviousAddressPage(
      'https://x.example/"><script>',
      DEFAULT_PAGE_LOCALE,
    ).body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('https://x.example/&quot;&gt;&lt;script&gt;');
  });

  it('declares its language and direction, and isolates the address in Arabic', () => {
    const page = renderPreviousAddressPage(CANONICAL, ARABIC);
    expect(page.html).toContain('<html lang="ar" dir="rtl">');
    expect(page.title).toBe('تم نقل هذا العنوان');
    expect(page.body).toContain('<bdi>https://login.acme.example</bdi>');
  });
});
