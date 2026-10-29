import { describe, expect, it } from 'vitest';
import { en, isMailMessageKey, MAIL_MESSAGES } from '#/service/messages';
import {
  renderFinishRegistration,
  renderRecoveryCodesRevoked,
  renderRegistrationDuplicate,
  renderRequiredActions,
  renderResetPassword,
  renderSecondFactorRemoved,
  renderSmtpTest,
  renderVerifyEmail,
} from '#/service/templates';

const LINK = 'https://idp.example/tenants/demo/login-actions/action-token?key=abc';
const NOW = new Date('2026-10-19T09:00:00Z');
const base = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Demo', now: NOW };
const ACTIONS = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
];

describe('the mail message keys', () => {
  it('are the English catalogue without the attribution a page does not carry either', () => {
    const attribution = ['mail.brand', 'mail.copyright', 'mail.poweredBy'];
    expect(Object.keys(MAIL_MESSAGES).sort()).toEqual(
      Object.keys(en)
        .filter((key) => !attribution.includes(key))
        .sort(),
    );
    for (const key of Object.keys(MAIL_MESSAGES)) expect(isMailMessageKey(key)).toBe(true);
    for (const key of [...attribution, 'constructor', '__proto__', 'login.title', '']) {
      expect(isMailMessageKey(key)).toBe(false);
    }
  });

  it('are all read by a mail, so none is listed that no mail could show', () => {
    // Every key replaced by its own name shows which keys some mail reads.
    const overrides = { en: Object.fromEntries(Object.keys(en).map((key) => [key, `«${key}»`])) };
    const shown = [
      renderVerifyEmail({ ...base, overrides }),
      renderFinishRegistration({ ...base, overrides }),
      renderResetPassword({ ...base, overrides }),
      renderRegistrationDuplicate({ ...base, resetLink: LINK, overrides }),
      renderRegistrationDuplicate({ ...base, resetLink: null, overrides }),
      renderRequiredActions({ ...base, overrides, actions: ACTIONS }),
      renderSecondFactorRemoved({ ...base, overrides, factor: 'totp', codes: true }),
      renderSecondFactorRemoved({ ...base, overrides, factor: 'webauthn', codes: false }),
      renderRecoveryCodesRevoked({ ...base, overrides, newSet: true }),
      renderSmtpTest({ ...base, overrides }),
    ]
      .map((mail) => mail.subject + mail.text + mail.html)
      .join('\n');
    const unread = Object.keys(MAIL_MESSAGES).filter((key) => !shown.includes(`«${key}»`));
    expect(unread).toEqual([]);
  });
});

describe('a mail with the tenant’s own wording', () => {
  const overrides = {
    en: {
      'reset.subject': 'Hello {tenant}: new password',
      'reset.heading': 'Choose again',
      'reset.body': 'Hi, this is {tenant} speaking.',
      'reset.button': 'Go',
    },
  };

  it('says the override in the subject, heading, body and button', () => {
    const mail = renderResetPassword({ ...base, overrides });
    expect(mail.subject).toBe('Hello Demo: new password');
    expect(mail.html).toContain('Choose again');
    expect(mail.html).toContain('Hi, this is <bdi>Demo</bdi> speaking.');
    expect(mail.html).toContain('>Go<');
    expect(mail.text).toContain(en['reset.text'].replace('{tenant}', '⁨Demo⁩'));
  });

  it('keeps the catalogue for what it does not override, and the link untouched', () => {
    const mail = renderResetPassword({ ...base, overrides });
    expect(mail.text).toContain(en['mail.notRequested']);
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain(`href="${LINK}"`);
  });

  it('reads the overrides of the language the mail is in, and no other', () => {
    const wrongLanguage = { ar: { 'reset.heading': 'ARABIC HEADING' } };
    expect(renderResetPassword({ ...base, overrides: wrongLanguage }).html).not.toContain(
      'ARABIC HEADING',
    );
    const mail = renderResetPassword({ ...base, locale: 'ar', overrides: wrongLanguage });
    expect(mail.html).toContain('ARABIC HEADING');
  });

  it('offers the languages the tenant offers, as its pages are negotiated', () => {
    const french = { fr: { 'reset.heading': 'EN FRANCAIS' } };
    const offered = renderResetPassword({
      ...base,
      locale: 'fr',
      supportedLocales: ['en', 'fr'],
      overrides: french,
    });
    expect(offered.html).toContain('EN FRANCAIS');
    expect(offered.html).toContain('<html lang="fr"');
    const notOffered = renderResetPassword({
      ...base,
      locale: 'fr',
      supportedLocales: ['en'],
      overrides: french,
    });
    expect(notOffered.html).not.toContain('EN FRANCAIS');
    expect(notOffered.html).toContain('<html lang="en"');
    const onlyEnglish = renderResetPassword({ ...base, locale: 'ar', supportedLocales: ['en'] });
    expect(onlyEnglish.html).toContain('<html lang="en"');
  });

  it('follows the tenant default language when the recipient has none', () => {
    const mail = renderResetPassword({
      ...base,
      tenantDefaultLocale: 'ar',
      overrides: { ar: { 'reset.heading': 'TENANT DEFAULT' } },
    });
    expect(mail.html).toContain('TENANT DEFAULT');
  });

  it('is the catalogue’s text when an override names an argument the mail does not supply', () => {
    const mail = renderResetPassword({
      ...base,
      overrides: { en: { 'reset.heading': 'Hello {nobody}' } },
    });
    expect(mail.html).toContain(en['reset.heading']);
    expect(mail.html).not.toContain('nobody');
  });

  it('shows markup and entities as text in the HTML part and never as markup', () => {
    const mail = renderResetPassword({
      ...base,
      overrides: {
        en: {
          'reset.heading': '<script>alert(1)</script> &amp; &lt;b&gt;',
          'reset.preheader': '<img src=x onerror=alert(1)>',
          'reset.body': '<script>alert(2)</script> for {tenant}',
          'reset.button': '"><script>alert(3)</script>',
          'reset.reason': '<i>why</i> {tenant}',
        },
      },
    });
    expect(mail.html).not.toContain('<script');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<i>why');
    expect(mail.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp; &amp;lt;b&amp;gt;',
    );
    expect(mail.html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('keeps a hostile tenant name in an argument escaped and isolated', () => {
    const mail = renderResetPassword({
      ...base,
      tenantDisplayName: '<script>x</script>&amp;',
      overrides: { en: { 'reset.body': 'Welcome to {tenant}', 'reset.heading': '{tenant}!' } },
    });
    expect(mail.html).not.toContain('<script');
    expect(mail.html).toContain('<bdi>&lt;script&gt;x&lt;/script&gt;&amp;amp;</bdi>');
  });

  it('cannot end the subject header: a break in the override becomes a space', () => {
    const mail = renderResetPassword({
      ...base,
      overrides: { en: { 'reset.subject': 'Hi\r\nBcc: evil@example.test\u2028x' } },
    });
    expect(mail.subject).not.toMatch(/[\r\n\u2028]/u);
  });

  it('words every kind of mail from the same overrides', () => {
    const wording = {
      en: {
        'notice.contact': 'CONTACT US',
        'duplicate.heading': 'DUP',
        'actions.button': 'ACT',
        'action.update-password': 'NEWPASS',
        'smtpTest.heading': 'SMTP',
      },
    };
    const removed = renderSecondFactorRemoved({
      ...base,
      factor: 'totp',
      codes: false,
      overrides: wording,
    });
    expect(removed.text).toContain('CONTACT US');
    const duplicate = renderRegistrationDuplicate({ ...base, resetLink: LINK, overrides: wording });
    expect(duplicate.html).toContain('DUP');
    const actions = renderRequiredActions({
      ...base,
      actions: ['update-password'],
      overrides: wording,
    });
    expect(actions.html).toContain('>ACT<');
    expect(actions.text).toContain('- NEWPASS');
    expect(renderSmtpTest({ ...base, overrides: wording }).html).toContain('SMTP');
  });
});
