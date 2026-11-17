import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'totp.title': "Configurez votre application d'authentification",
    'totp.key': 'Clé :',
    'totp.confirm': 'Confirmer',
    'refusal.codeMismatch': 'Ce code ne correspond pas.',
  });
});

const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=acme&algorithm=SHA1&digits=6&period=30',
};

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderTotpEnrolmentPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe('Set up your authenticator');
    expect(page.body).toContain('Scan this with your authenticator app');
    expectFragment(page);
  });

  it('draws the URI as a QR code as well as text', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.html).toContain('<svg');
    expect(page.html).toContain('</svg>');
    expect(page.html).toContain(`value="${OFFER.secret}"`);
  });

  // The URI carries `&` between its parameters, which is an entity
  // reference in HTML: printed raw it is not the string an app would read
  // back, and the same escaping is what keeps an interpolated value from
  // closing the tag it sits in.
  it('escapes the URI where it appears as text', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.html).toContain(
      '<code>otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&amp;issuer=acme&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code>',
    );
    expect(page.html).not.toContain('period=30</code>&');
  });

  it('escapes the tenant, the session id, the secret and the URI', () => {
    const page = renderTotpEnrolmentPage(
      'acme"><script>',
      pathAddress('https://idp.example', 'acme"><script>'),
      'session"><script>',
      { secret: '"><script>S', uri: 'otpauth://x?a=<script>&b="' },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.html).not.toContain('<script>');
    expect(page.html).toContain('&lt;script&gt;');
    expect(page.html).toContain('name="secret" value="&quot;&gt;&lt;script&gt;S"');
    expect(page.html).toContain('<code>otpauth://x?a=&lt;script&gt;&amp;b=&quot;</code>');
  });

  it('says what the app must support when the parameters are not the common ones', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sess-1',
      { ...OFFER, parameters: { algorithm: 'SHA256', digits: 8, period: 60 } },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(
      'This authenticator uses SHA256, 8 digits and a 60-second period. Your app must support all three',
    );
  });

  it('says nothing of the parameters every app supports', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sess-1',
      { ...OFFER, parameters: { algorithm: 'SHA1', digits: 6, period: 30 } },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).not.toContain('Your app must support');
  });

  it('keeps the English markup exactly', () => {
    const { body } = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sess-1',
      OFFER,
      'code_mismatch',
      DEFAULT_PAGE_LOCALE,
    );
    expect(body.replace(/<svg[\s\S]*<\/svg>/u, '<SVG>')).toBe(`<header class="intro">
<h1>Set up your authenticator</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That code did not match. Try the next one your app shows.</li>
</ul>
</div>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<SVG>
<p><bdi dir="ltr"><code>otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&amp;issuer=acme&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ</code></bdi></p>
<form method="post" action="/tenants/acme/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="sess-1">
  <input type="hidden" name="secret" value="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <button type="submit">Confirm</button>
</form>`);
  });

  it('reads French where the fixture has it, English for the rest, and keeps the secret in the same places', () => {
    const page = renderTotpEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's1',
      OFFER,
      'code_mismatch',
      FRENCH,
    );
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe("Configurez votre application d'authentification");
    expect(page.body).toContain('<li id="form-error-0">Ce code ne correspond pas.</li>');
    expect(page.body).toContain('<p>Clé : <bdi dir="ltr"><code>');
    expect(page.body).toContain('<button type="submit">Confirmer</button>');
    expect(page.body).toContain(`<p>${en['totp.scan']}</p>`);
    expect(page.body).toContain(`value="${OFFER.secret}"`);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderTotpEnrolmentPage(
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
      renderTotpEnrolmentPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).html,
    ).not.toContain('<strong>');
  });

  it('needs no script, so the page asks for no policy beyond the base one', () => {
    expect(
      renderTotpEnrolmentPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).script,
    ).toBeNull();
  });
});
