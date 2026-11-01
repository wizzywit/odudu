import { describe, expect, it } from 'vitest';
import { ar } from '#/service/messages';
import { renderResetPassword, renderVerifyEmail } from '#/service/templates';

const LINK = 'https://idp.example/tenants/demo/login-actions/action-token?key=abc';
const NOW = new Date('2026-10-19T09:00:00Z');
const input = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Demo', now: NOW };

// Mail clients do not read logical properties, so a right-to-left mail says
// its direction with the `dir` attribute and aligns with a physical
// `text-align:right`; the address, which is Latin, stays left to right.
describe('a mail in Arabic', () => {
  const html = renderVerifyEmail({ ...input, locale: 'ar' }).html;

  it('declares lang="ar" dir="rtl" and aligns its text to the right', () => {
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('text-align:right');
    expect(html).not.toContain('text-align:left;word-break');
  });

  it('keeps the link left to right', () => {
    expect(html).toContain('dir="ltr"><a class="m-link"');
  });

  it('says every sentence in Arabic, and the tenant name isolated in the text', () => {
    const message = renderResetPassword({ ...input, locale: 'ar' });
    expect(message.subject).toBe('أعد تعيين كلمة مرورك في Demo');
    expect(message.html).toContain(ar['reset.heading']);
    expect(message.html).toContain(ar['reset.button']);
    expect(message.text).toContain('\u2068Demo\u2069');
    expect(message.text).toContain(ar['mail.notRequested']);
  });

  it('leaves an English mail left to right', () => {
    const english = renderVerifyEmail(input).html;
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(english).not.toContain('text-align:right');
  });
});
