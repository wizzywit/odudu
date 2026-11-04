import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'recoveryCodes.title': 'Enregistrez vos codes de secours',
    'recoveryCodes.onlyTime': 'Ils ne sont affichés qu’une seule fois.',
    'recoveryCodes.acknowledge': 'J’ai enregistré ces codes',
    'refusal.codesNotSaved': 'Enregistrez ces codes avant de continuer.',
  });
});

const OFFER = { codes: ['ABCDE-FGHJK', 'MNPQR-STVWX'], replaced: false };

describe('renderRecoveryCodesPage', () => {
  it('prints every code and says it is the only time they are shown', () => {
    const page = renderRecoveryCodesPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    for (const code of OFFER.codes) {
      expect(page.html).toContain(`<code>${code}</code>`);
    }
    expect(page.html).toContain('only time they are shown');
  });

  // The form carries no code back — only the acknowledgement. A code in a
  // hidden field would be a second copy of the plaintext, in a page the
  // browser can resubmit.
  it('carries the session id back and nothing else', () => {
    const page = renderRecoveryCodesPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.html).toContain('name="auth_session_id" value="auth-session-1"');
    expect(page.html).toContain(
      'action="/tenants/acme/login-actions/required-action?action=generate-recovery-codes"',
    );
    expect(page.html).not.toContain('type="hidden" name="code');
  });

  it('needs no script, so the page asks for no policy beyond the base one', () => {
    expect(
      renderRecoveryCodesPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).script,
    ).toBeNull();
    expect(
      renderRecoveryCodesPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).html,
    ).not.toContain('<script');
  });

  it('says so when this set retires an earlier one, and stays quiet when it does not', () => {
    const first = renderRecoveryCodesPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    const again = renderRecoveryCodesPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      { ...OFFER, replaced: true },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(first.html).not.toContain('no longer work');
    expect(again.html).toContain('no longer work');
  });

  it('escapes the tenant, the session id and a code, and keeps a code left to right', () => {
    const page = renderRecoveryCodesPage(
      'acme"><script>',
      pathAddress('https://idp.example', 'acme"><script>'),
      'session"><script>',
      { codes: ['<script>'], replaced: false },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.html).not.toContain('<script>');
    expect(page.html).toContain('<bdi dir="ltr"><code>&lt;script&gt;</code></bdi>');
  });

  it('keeps the English markup exactly', () => {
    expect(
      renderRecoveryCodesPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sess-1',
        { codes: ['ABCDE-FGHJK', 'MNPQR-STVWX'], replaced: true },
        'codes_not_saved',
        DEFAULT_PAGE_LOCALE,
      ).body,
    ).toBe(`<header class="intro">
<h1>Save your recovery codes</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Save these codes before continuing.</li>
</ul>
</div>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<p>These replace the codes issued to this account before now, which no longer work.</p>
<ol>
  <li><bdi dir="ltr"><code>ABCDE-FGHJK</code></bdi></li>
  <li><bdi dir="ltr"><code>MNPQR-STVWX</code></bdi></li>
</ol>
<form method="post" action="/tenants/acme/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="sess-1">
  <button type="submit">I have saved these codes</button>
</form>`);
  });

  it('reads French where the fixture has it and English for the rest, codes unchanged', () => {
    const page = renderRecoveryCodesPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's1',
      OFFER,
      'codes_not_saved',
      FRENCH,
    );
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Enregistrez vos codes de secours');
    expect(page.body).toContain(
      '<li id="form-error-0">Enregistrez ces codes avant de continuer.</li>',
    );
    expect(page.body).toContain('<strong>Ils ne sont affichés qu’une seule fois.</strong>');
    expect(page.body).toContain(`${en['recoveryCodes.keep']}</p>`);
    expect(page.body).toContain('>J’ai enregistré ces codes</button>');
    for (const code of OFFER.codes) {
      expect(page.body).toContain(`<bdi dir="ltr"><code>${code}</code></bdi>`);
    }
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderRecoveryCodesPage(
        'a',
        pathAddress('https://idp.example', 'a'),
        's',
        OFFER,
        undefined,
        ARABIC,
      ).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });

  it('says nothing about an error when there is none', () => {
    expect(
      renderRecoveryCodesPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).html,
    ).not.toContain('role="alert"');
  });
});
