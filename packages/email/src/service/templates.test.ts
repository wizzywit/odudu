import { describe, expect, it, vi } from 'vitest';
import { en } from '#/service/messages';
import {
  renderFinishRegistration,
  renderRecoveryCodesRevoked,
  renderRegistrationDuplicate,
  renderRequiredActions,
  renderSecondFactorRemoved,
  renderResetPassword,
  renderSmtpTest,
  renderVerifyEmail,
} from '#/service/templates';

vi.mock('#/service/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'verify.subject': 'Vérifiez votre compte {tenant}',
    'verify.preheader': 'Confirmez votre adresse pour terminer la création de votre compte.',
    'verify.heading': 'Vérifiez votre adresse e-mail',
    'verify.text': 'Confirmez votre adresse e-mail pour {tenant} en ouvrant ce lien :',
    'verify.body': 'Confirmez que cette adresse e-mail est bien la vôtre pour {tenant}.',
    'verify.button': 'Vérifier l’e-mail',
    'verify.reason': 'Vous recevez ce message car cette adresse a servi chez {tenant}.',
    'mail.linkFallback': 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    'mail.copyright': '© {year} Odudu',
    'mail.poweredBy': 'Propulsé par odudu',
    'reset.subject': 'Réinitialisez votre mot de passe {tenant}',
    'actions.subject': 'Mettez à jour votre compte {tenant}',
    'action.update-password': 'Choisir un nouveau mot de passe',
    'factorRemoved.subject': 'Une méthode de connexion a été retirée de votre compte {tenant}',
    'recoveryRevoked.subject': 'Les codes de récupération de {tenant} ont été révoqués',
    'smtpTest.subject': 'Test SMTP Odudu',
    'smtpTest.text': 'Ceci est un message de test d’Odudu.',
  });
});

const LINK = 'https://idp.example/tenants/demo/login-actions/action-token?key=abc';
const NOW = new Date('2026-10-19T09:00:00Z');
const FSI = '\u2068';
const PDI = '\u2069';

function fill(message: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, value),
    message,
  );
}

function footerText(reason: string, tenant: string, year = '2026'): string {
  return `--\n${fill(reason, { tenant: `${FSI}${tenant}${PDI}` })}\n${fill(en['mail.copyright'], { year })} · ${en['mail.poweredBy']}`;
}

describe('renderVerifyEmail', () => {
  const input = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Demo', now: NOW };

  it('reads subject, text and html from the catalogue', () => {
    const msg = renderVerifyEmail(input);
    expect(msg.to).toBe('ada@example.test');
    expect(msg.subject).toBe(fill(en['verify.subject'], { tenant: 'Demo' }));
    expect(msg.text).toBe(
      `${fill(en['verify.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n${LINK}\n\n${en['mail.notRequested']}\n\n${footerText(en['verify.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain(`<h1`);
    expect(msg.html).toContain(en['verify.heading']);
    expect(msg.html).toContain(fill(en['verify.body'], { tenant: '<bdi>Demo</bdi>' }));
    expect(msg.html).toContain(en['verify.button']);
    expect(msg.html).toContain(en['mail.linkFallback']);
    expect(msg.html).toContain(en['mail.notRequested']);
  });

  it('keeps the English subject and text, the tenant name isolated', () => {
    const msg = renderVerifyEmail(input);
    expect(msg.subject).toBe('Verify your Demo account');
    expect(msg.text).toBe(
      `Confirm your email address for ${FSI}Demo${PDI} by visiting this link:\n\n${LINK}\n\nIf you did not request this, you can ignore this message.\n\n--\nYou received this because this email address was used to create or update an account at ${FSI}Demo${PDI}.\n© 2026 Odudu · Powered by odudu`,
    );
  });

  it('defaults to English when no locale is given, or none is held', () => {
    const english = renderVerifyEmail(input);
    for (const locale of [undefined, null, 'de', 'not a tag', 'zh-Hant-TW']) {
      expect(renderVerifyEmail({ ...input, locale })).toEqual(english);
    }
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const msg = renderVerifyEmail({ ...input, locale: 'fr' });
    expect(msg.subject).toBe('Vérifiez votre compte Demo');
    expect(msg.text).toContain(
      `Confirmez votre adresse e-mail pour ${FSI}Demo${PDI} en ouvrant ce lien :\n\n${LINK}\n\n${en['mail.notRequested']}`,
    );
    expect(msg.text).toContain('© 2026 Odudu · Propulsé par odudu');
    expect(msg.html).toContain('<html lang="fr" dir="ltr">');
    expect(msg.html).toContain('Vérifier l’e-mail');
    expect(msg.html).toContain(
      'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    );
    expect(msg.html).toContain('Propulsé par odudu');
    expect(msg.html).toContain(
      'Confirmez votre adresse pour terminer la création de votre compte.',
    );
    expect(msg.html).toContain(
      'Vous recevez ce message car cette adresse a servi chez <bdi>Demo</bdi>.',
    );
  });

  it('matches a regional tag to the language it holds', () => {
    expect(renderVerifyEmail({ ...input, locale: 'fr-CA' }).subject).toBe(
      'Vérifiez votre compte Demo',
    );
  });

  it('escapes the link in the markup and leaves it as given in the text', () => {
    const link = 'https://idp.example/x?key=a&b=c"d';
    const msg = renderVerifyEmail({ ...input, link });
    expect(msg.html).toContain('href="https://idp.example/x?key=a&amp;b=c&quot;d"');
    expect(msg.html).not.toContain('b=c"d');
    expect(msg.text).toContain(`\n\n${link}\n\n`);
  });

  it('refuses a link that is not an absolute http or https URL', () => {
    for (const link of [
      'javascript:alert(1)',
      'data:text/html,x',
      '/relative',
      'ftp://x.test/',
      '',
    ]) {
      expect(() => renderVerifyEmail({ ...input, link })).toThrow(RangeError);
      expect(() => renderResetPassword({ ...input, link })).toThrow(RangeError);
      expect(() => renderRequiredActions({ ...input, link, actions: [] })).toThrow(RangeError);
    }
  });

  it('refuses a send time that is not a date', () => {
    expect(() => renderVerifyEmail({ ...input, now: new Date(Number.NaN) })).toThrow(RangeError);
  });

  it('escapes a tenant name that contains markup, and leaves it as typed in the text', () => {
    const msg = renderVerifyEmail({ ...input, tenantDisplayName: '<script>x</script> & "q"' });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('<bdi>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</bdi>');
    expect(msg.text).toContain(`${FSI}<script>x</script> & "q"${PDI}`);
    expect(msg.subject).toBe('Verify your <script>x</script> & "q" account');
  });

  it('strips bidi controls from the subject, because a header cannot carry an isolate', () => {
    const msg = renderVerifyEmail({ ...input, tenantDisplayName: 'Acme\u202eGP\u2066x\u2069' });
    expect(msg.subject).toBe('Verify your AcmeGPx account');
  });

  it('cannot close its own isolate: the text holds the one pop it wrote per mention', () => {
    const msg = renderVerifyEmail({
      ...input,
      tenantDisplayName: `evil${PDI} \u202e injected`,
    });
    const mentions = (msg.text.match(new RegExp(FSI, 'gu')) ?? []).length;
    expect(msg.text.split(PDI)).toHaveLength(mentions + 1);
    expect(msg.text).not.toContain('\u202e');
    expect(msg.html).not.toContain('\u202e');
  });

  it('[ODUDU-THEME-MAILHEADER-01] never lets a name put a line break into the subject or start a line in the text', () => {
    const hostile = 'Acme\r\nBcc: evil@example.test\u2028more\u0085x\u0000y';
    const msg = renderVerifyEmail({ ...input, tenantDisplayName: hostile });
    expect(msg.subject).not.toMatch(/[\r\n\u2028\u2029\u0085\u0000]/u);
    expect(msg.subject).toBe('Verify your Acme Bcc: evil@example.test more x y account');
    const [first = ''] = msg.text.split('\n');
    expect(first).toContain('Acme Bcc: evil@example.test more x y');
    expect(msg.text.split('\n').filter((line) => line.startsWith('Bcc:'))).toEqual([]);
  });

  it('cannot reach the link through a name that spells a placeholder', () => {
    const msg = renderVerifyEmail({ ...input, tenantDisplayName: '{link} {tenant}' });
    expect(msg.html).toContain('<bdi>{link} {tenant}</bdi>');
    expect(msg.html.match(/<a /gu)).toHaveLength(2);
  });

  it('isolates a right-to-left tenant name, leaves its marks alone, and lays the page out right to left', () => {
    const msg = renderVerifyEmail({ ...input, tenantDisplayName: 'شركة\u200f' });
    expect(msg.html).toContain('<bdi>شركة\u200f</bdi>');
    expect(msg.text).toContain(`${FSI}شركة\u200f${PDI}`);
  });
});

describe('renderResetPassword', () => {
  const input = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Demo', now: NOW };

  it('reads subject, text and html from the catalogue', () => {
    const msg = renderResetPassword(input);
    expect(msg.subject).toBe(fill(en['reset.subject'], { tenant: 'Demo' }));
    expect(msg.text).toBe(
      `${fill(en['reset.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n${LINK}\n\n${en['mail.notRequested']}\n\n${footerText(en['reset.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain(en['reset.heading']);
    expect(msg.html).toContain(fill(en['reset.body'], { tenant: '<bdi>Demo</bdi>' }));
    expect(msg.html).toContain(en['reset.button']);
  });

  it('keeps the English subject and text', () => {
    const msg = renderResetPassword(input);
    expect(msg.subject).toBe('Reset your Demo password');
    expect(msg.text).toContain(
      `Reset your password for ${FSI}Demo${PDI} by visiting this link:\n\n${LINK}\n\n`,
    );
  });

  it('reads French for the subject and English for the keys the fixture lacks', () => {
    const msg = renderResetPassword({ ...input, locale: 'fr' });
    expect(msg.subject).toBe('Réinitialisez votre mot de passe Demo');
    expect(msg.text).toContain('Reset your password for');
  });

  it('strips CR, LF and bidi controls from the subject', () => {
    const msg = renderResetPassword({ ...input, tenantDisplayName: 'A\r\nSubject: x\u202e' });
    expect(msg.subject).toBe('Reset your A Subject: x password');
  });
});

describe('renderRequiredActions', () => {
  const input = {
    to: 'ada@example.test',
    link: LINK,
    tenantDisplayName: 'Demo',
    now: NOW,
    actions: ['update-password', 'configure-passkey'],
  };

  it('reads subject, intro, each action and the closing lines from the catalogue', () => {
    const msg = renderRequiredActions(input);
    expect(msg.subject).toBe(fill(en['actions.subject'], { tenant: 'Demo' }));
    expect(msg.text).toBe(
      `${fill(en['actions.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n- ${en['action.update-password']}\n- ${en['action.configure-passkey']}\n\n${en['actions.textLink']}\n\n${LINK}\n\n${en['actions.ignore']}\n\n${footerText(en['actions.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain(en['actions.heading']);
    expect(msg.html).toContain(fill(en['actions.text'], { tenant: '<bdi>Demo</bdi>' }));
    expect(msg.html).toContain(en['actions.button']);
    expect(msg.html).toContain(en['actions.ignore']);
    expect(msg.html).toMatch(
      /<li[^>]*>Choose a new password<\/li><li[^>]*>Register a passkey<\/li>/u,
    );
  });

  it('reads an action in French where the fixture has it', () => {
    const msg = renderRequiredActions({ ...input, locale: 'fr' });
    expect(msg.subject).toBe('Mettez à jour votre compte Demo');
    expect(msg.text).toContain('- Choisir un nouveau mot de passe\n- Register a passkey');
    expect(msg.html).toMatch(
      /<li[^>]*>Choisir un nouveau mot de passe<\/li><li[^>]*>Register a passkey<\/li>/u,
    );
  });

  it('shows an action code this build has no sentence for, isolated and escaped', () => {
    const msg = renderRequiredActions({ ...input, actions: ['update-password', '<b>weird'] });
    expect(msg.html).toContain('<bdi>&lt;b&gt;weird</bdi></li>');
    expect(msg.html).not.toContain('<b>');
    expect(msg.text).toContain(`- ${FSI}<b>weird${PDI}`);
  });

  it('keeps an action code from taking another message by naming its id', () => {
    const msg = renderRequiredActions({ ...input, actions: ['x', 'verify.subject'] });
    expect(msg.text).toContain(`- ${FSI}x${PDI}\n- ${FSI}verify.subject${PDI}`);
  });

  it('escapes the tenant name and strips bidi controls from the subject', () => {
    const msg = renderRequiredActions({ ...input, tenantDisplayName: 'Demo <Co>\u202e' });
    expect(msg.html).not.toContain('<Co>');
    expect(msg.subject).toBe('Update your Demo <Co> account');
  });
});

describe('renderSecondFactorRemoved', () => {
  const input = { to: 'ada@example.test', tenantDisplayName: 'Demo', now: NOW };

  it('names the factor and says the codes went with it, in English', () => {
    const msg = renderSecondFactorRemoved({ ...input, factor: 'totp', codes: true });
    expect(msg.to).toBe('ada@example.test');
    expect(msg.subject).toBe('A sign-in method was removed from your Demo account');
    expect(msg.text).toContain('authenticator app');
    expect(msg.text).toContain('recovery codes were removed with it');
    expect(msg.html).toContain('<bdi>Demo</bdi>');
    expect(msg.html).toContain(en['factorRemoved.heading']);
  });

  it('names a passkey, and leaves out the codes sentence when none were held', () => {
    const msg = renderSecondFactorRemoved({ ...input, factor: 'webauthn', codes: false });
    expect(msg.text).toContain('passkey');
    expect(msg.text).not.toContain('recovery codes');
    expect(msg.html).not.toContain('recovery codes');
  });

  it('carries no link, no code and no secret', () => {
    const msg = renderSecondFactorRemoved({ ...input, factor: 'totp', codes: true });
    expect(msg.text + msg.html).not.toMatch(/https?:|<a |[0-9A-Z]{5}-[0-9A-Z]{5}/u);
  });

  it('reads the subject in French where the fixture has it, English for the rest', () => {
    const msg = renderSecondFactorRemoved({ ...input, factor: 'totp', codes: true, locale: 'fr' });
    expect(msg.subject).toBe('Une méthode de connexion a été retirée de votre compte Demo');
    expect(msg.text).toContain('authenticator app');
  });
});

describe('renderRecoveryCodesRevoked', () => {
  const input = { to: 'ada@example.test', tenantDisplayName: 'Demo', now: NOW };

  it('says the old codes stop working, and that a new set will be asked for', () => {
    const msg = renderRecoveryCodesRevoked({ ...input, newSet: true });
    expect(msg.subject).toBe('Your Demo recovery codes were revoked');
    expect(msg.text).toContain('no longer work');
    expect(msg.text).toContain('save a new set');
    expect(msg.html).toContain('save a new set');
  });

  it('leaves the new-set sentence out when none is asked for', () => {
    const msg = renderRecoveryCodesRevoked({ ...input, newSet: false });
    expect(msg.text).not.toContain('new set');
    expect(msg.html).not.toContain('new set');
  });

  it('reads the subject in French where the fixture has it', () => {
    const msg = renderRecoveryCodesRevoked({ ...input, newSet: true, locale: 'fr' });
    expect(msg.subject).toBe('Les codes de récupération de Demo ont été révoqués');
  });
});

describe('renderSmtpTest', () => {
  const input = { to: 'ops@example.test', tenantDisplayName: 'Demo', now: NOW };

  it('keeps the English test mail, with the tenant it was sent from', () => {
    const msg = renderSmtpTest(input);
    expect(msg.to).toBe('ops@example.test');
    expect(msg.subject).toBe('Odudu SMTP test');
    expect(msg.text).toBe(
      `This is a test message from Odudu.\n\n${footerText(en['smtpTest.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain('This is a test message from Odudu.');
    expect(msg.html).toContain('<bdi>Demo</bdi>');
  });

  it('reads subject and text from the catalogue, in the locale asked for', () => {
    const msg = renderSmtpTest({ ...input, locale: 'fr' });
    expect(msg.subject).toBe('Test SMTP Odudu');
    expect(msg.text).toContain('Ceci est un message de test d’Odudu.');
    expect(msg.html).toContain('Ceci est un message de test d’Odudu.');
  });

  it('falls back to English for a locale it holds no catalogue for', () => {
    expect(renderSmtpTest({ ...input, locale: 'ja' }).subject).toBe('Odudu SMTP test');
  });
});

describe('renderRegistrationDuplicate', () => {
  const RESET = 'https://idp.example/tenants/demo/login-actions/reset-password';
  const input = {
    to: 'ada@example.test',
    resetLink: RESET,
    tenantDisplayName: 'Demo',
    now: NOW,
  };

  it('tells the address holder they already have an account, and offers a reset', () => {
    const msg = renderRegistrationDuplicate(input);
    expect(msg.to).toBe('ada@example.test');
    expect(msg.subject).toBe('You already have a Demo account');
    expect(msg.text).toBe(
      `${fill(en['duplicate.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n${en['duplicate.next']}\n\n${RESET}\n\n${en['mail.notRequested']}\n\n${footerText(en['duplicate.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain(en['duplicate.heading']);
    expect(msg.html).toContain(en['duplicate.button']);
    expect(msg.html).toContain(`href="${RESET}"`);
    expect(msg.html).toContain(en['mail.notRequested']);
  });

  it('has no link and no button where the tenant has no password reset', () => {
    const msg = renderRegistrationDuplicate({ ...input, resetLink: null });
    expect(msg.text).toBe(
      `${fill(en['duplicate.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n${en['duplicate.nextSignIn']}\n\n${en['mail.notRequested']}\n\n${footerText(en['duplicate.reason'], 'Demo')}`,
    );
    expect(msg.html).not.toContain('href=');
    expect(msg.html).not.toContain(en['duplicate.button']);
  });

  it('carries no username, token or account detail, only what the person asked for', () => {
    const msg = renderRegistrationDuplicate(input);
    expect(msg.text).not.toContain('key=');
    expect(msg.html).not.toContain('key=');
  });

  it('refuses a link that is not an absolute http or https URL', () => {
    expect(() =>
      renderRegistrationDuplicate({ ...input, resetLink: 'javascript:alert(1)' }),
    ).toThrow(RangeError);
  });

  it('strips line breaks and bidi controls from the subject, and escapes markup in the body', () => {
    const msg = renderRegistrationDuplicate({
      ...input,
      tenantDisplayName: 'Evil\r\nBcc: x<script>',
    });
    expect(msg.subject).not.toMatch(/[\r\n]/u);
    expect(msg.html).not.toContain('<script>');
  });
});

describe('renderFinishRegistration', () => {
  const input = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Demo', now: NOW };

  it('says someone asked, and that opening the link is how to choose a password', () => {
    const msg = renderFinishRegistration(input);
    expect(msg.subject).toBe('Finish creating your Demo account');
    expect(msg.text).toBe(
      `${fill(en['finish.text'], { tenant: `${FSI}Demo${PDI}` })}\n\n${LINK}\n\n${en['mail.notRequested']}\n\n${footerText(en['finish.reason'], 'Demo')}`,
    );
    expect(msg.html).toContain(en['finish.heading']);
    expect(msg.html).toContain(en['finish.button']);
    expect(msg.html).toContain(en['mail.notRequested']);
  });
});
