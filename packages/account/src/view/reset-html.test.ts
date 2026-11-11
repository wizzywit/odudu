import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordFactorsRemovedPage,
  renderResetPasswordSucceededPage,
  renderResetRequestedPage,
  renderResetRequestFailedPage,
  renderResetRequestForm,
} from '#/view/reset-html';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'reset.request.title': 'Mot de passe oublié ?',
    'reset.requested.next':
      'Si cette adresse a un compte, nous avons envoyé un lien pour réinitialiser son mot de passe.',
    'reset.requestFailed.emailRequired': "L'adresse e-mail est obligatoire.",
    'reset.form.newPassword': 'Nouveau mot de passe',
    'reset.linkFailed.heading': "Ce lien n'est pas utilisable",
    'reset.required.reason': 'Un nouveau mot de passe est obligatoire.',
    'password.rule.minLength':
      'Le mot de passe doit comporter au moins {min, number, ::group-off} caractères.',
  });
});

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

const EN = DEFAULT_PAGE_LOCALE;

// The page's script carries a nonce fresh for each response.
const withoutScript = (body: string): string =>
  body.replace(/<script nonce="[^"]*">[\s\S]*?<\/script>/u, '<script nonce="N">…</script>');

const RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

describe('renderResetRequestForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetRequestForm('acme', pathAddress('https://idp.example', 'acme'), {}, EN);
    expect(page.title).toBe('Forgot your password?');
    expect(page.body).toContain('name="email"');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(renderResetRequestForm('acme', pathAddress('https://idp.example', 'acme'), {}, EN).body)
      .toBe(`<header class="intro">
<h1>Forgot your password?</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<form method="post" action="/tenants/acme/login-actions/reset-password">
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <button type="submit">Send reset link</button>
</form>`);
  });

  it('links back to sign-in and carries the way in the form', () => {
    const way = '/tenants/acme/protocol/openid-connect/auth?client_id=portal&state=x';
    const { body } = renderResetRequestForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { signInPath: way },
      EN,
    );
    expect(body).toContain(
      '<input type="hidden" name="return_to" value="/tenants/acme/protocol/openid-connect/auth?client_id=portal&amp;state=x">',
    );
    expect(body).toContain(
      '<p class="links">\n<a href="/tenants/acme/protocol/openid-connect/auth?client_id=portal&amp;state=x">Back to sign in</a>\n</p>',
    );
  });

  it('comes back in place with the message, the field marked and focused', () => {
    const { body } = renderResetRequestForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { emailRequired: true },
      EN,
    );
    expect(body).toContain(`<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Email is required.</li>
</ul>
</div>
<form`);
    expect(body).toContain(
      'name="email" autocomplete="email" aria-invalid="true" aria-describedby="form-error-0" autofocus>',
    );
  });

  it('gives a typed address back, escaped and bounded', () => {
    expect(
      renderResetRequestForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { email: '"><i>' },
        EN,
      ).body,
    ).toContain('value="&quot;&gt;&lt;i&gt;"');
    expect(
      renderResetRequestForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { email: 'x'.repeat(600) },
        EN,
      ).body,
    ).not.toContain('xxxxxxxx');
  });

  it('reads French, and English for what the fixture lacks', () => {
    const page = renderResetRequestForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      {},
      FRENCH,
    );
    expect(page.title).toBe('Mot de passe oublié ?');
    expect(page.body).toContain(`<label>${en['reset.request.email']} <input`);
  });

  it('writes the tenant into the action as a path segment', () => {
    expect(
      renderResetRequestForm('a b"><b>', pathAddress('https://idp.example', 'a b"><b>'), {}, EN)
        .html,
    ).toContain('action="/tenants/a%20b%22%3E%3Cb%3E/login-actions/reset-password"');
  });
});

describe('renderResetRequestedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetRequestedPage(null, EN);
    expect(page.title).toBe('Check your email');
    expect(page.body).toContain('we&#39;ve sent a link');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(renderResetRequestedPage(null, EN).body).toBe(`<h1>Check your email</h1>
<p>If that address has an account, we&#39;ve sent a link to reset its password.</p>`);
  });

  it('links back to sign-in when the way was carried', () => {
    expect(
      renderResetRequestedPage('/tenants/acme/protocol/openid-connect/auth?a=b', EN).body,
    ).toContain(
      '<p class="links">\n<a href="/tenants/acme/protocol/openid-connect/auth?a=b">Back to sign in</a>\n</p>',
    );
  });

  it('reads French, and English for what the fixture lacks', () => {
    const page = renderResetRequestedPage(null, FRENCH);
    expect(page.body).toContain('<p>Si cette adresse a un compte, nous avons envoyé');
    expect(page.title).toBe(en['reset.requested.title']);
  });
});

describe('renderResetRequestFailedPage', () => {
  it('stays a page for the refusal that is not about the field, with the way to try again', () => {
    const page = renderResetRequestFailedPage(pathAddress('https://idp.example', 'acme'), null, EN);
    expect(page.title).toBe("Can't send a reset link");
    expect(page.body).toBe(`<h1>Can&#39;t send a reset link</h1>
<p>Password reset is temporarily unavailable. Try again later.</p>
<p class="links">
<a href="/tenants/acme/login-actions/reset-password">Try again</a>
</p>`);
    expectFragment(page);
  });

  it('keeps the way back through the retry and beside it', () => {
    const way = '/tenants/acme/protocol/openid-connect/auth?a=b';
    const { body } = renderResetRequestFailedPage(
      pathAddress('https://idp.example', 'acme'),
      way,
      EN,
    );
    expect(body).toContain(
      `href="/tenants/acme/login-actions/reset-password?return_to=${encodeURIComponent(way)}">Try again</a>`,
    );
    expect(body).toContain(`<a href="${way}">Back to sign in</a>`);
  });

  it('reads French, and English for what the fixture lacks', () => {
    expect(
      renderResetRequestFailedPage(pathAddress('https://idp.example', 'acme'), null, FRENCH).body,
    ).toContain(en['reset.requestFailed.unavailable']);
  });
});

describe('renderResetPasswordForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'token-key',
      undefined,
      RULES,
      EN,
    );
    expect(page.title).toBe('Choose a new password');
    expect(page.body).toContain('value="token-key"');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(
      withoutScript(
        renderResetPasswordForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'token-key',
          undefined,
          RULES,
          EN,
        ).body,
      ),
    ).toBe(`<header class="intro">
<h1>Choose a new password</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<form method="post" action="/tenants/acme/login-actions/action-token">
  <input type="hidden" name="key" value="token-key">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="N">…</script>
  <button type="submit">Reset password</button>
</form>`);
  });

  it('comes back in place with every broken rule, the password field marked and focused', () => {
    const { body } = renderResetPasswordForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'token-key',
      [
        { rule: 'min-length', message: 'dev', minLength: 8 },
        { rule: 'not-reused', message: 'dev' },
      ],
      RULES,
      EN,
    );
    expect(body).toContain(`<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 8 characters long.</li>
<li id="form-error-1">Password must not be one you have used before.</li>
</ul>
</div>
<form`);
    expect(body).toContain('<input type="hidden" name="key" value="token-key">');
    expect(body).toContain(
      'autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 form-error-1 password-rules-list" autofocus>',
    );
    expect(body).not.toMatch(/name="password"[^>]*value=/u);
  });

  it('says a password is required, in French where the fixture has it', () => {
    expect(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'k',
        'required',
        RULES,
        EN,
      ).body,
    ).toContain('<li id="form-error-0">A new password is required.</li>');
    expect(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'k',
        'required',
        RULES,
        FRENCH,
      ).body,
    ).toContain('<li id="form-error-0">Un nouveau mot de passe est obligatoire.</li>');
  });

  it('reads French rules, English for the rest, and isolates an unknown rule', () => {
    const { body } = renderResetPasswordForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'k',
      [
        { rule: 'min-length', message: 'dev', minLength: 1000 },
        { rule: 'require-digit', message: 'dev' },
        { rule: 'x', message: '<b>y</b>' },
      ],
      RULES,
      FRENCH,
    );
    expect(body).toContain('>Le mot de passe doit comporter au moins 1000 caractères.</li>');
    expect(body).toContain(`>${en['password.rule.requireDigit']}</li>`);
    expect(body).toContain('<li id="form-error-2"><bdi>&lt;b&gt;y&lt;/b&gt;</bdi></li>');
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'k',
        [],
        RULES,
        ARABIC,
      ).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });

  it('reads French, keeps the key and tenant escaped, and carries one script', () => {
    const page = renderResetPasswordForm(
      '<t>',
      pathAddress('https://idp.example', '<t>'),
      '"><img src=x>',
      undefined,
      RULES,
      FRENCH,
    );
    expect(page.body).toContain('<label>Nouveau mot de passe <input');
    expect(page.html).not.toContain('<img src=x>');
    expect(page.html).not.toContain('<t>');
    expect(page.body).toContain('value="&quot;&gt;&lt;img src=x&gt;"');
    expect(page.script?.fetchesSameOrigin).toBe(false);
  });
});

describe('renderResetPasswordSucceededPage', () => {
  it('says what was removed only when something was', () => {
    expect(renderResetPasswordFactorsRemovedPage(null, null, EN).body).toContain(
      'We removed the authenticator app, passkeys and recovery codes',
    );
    expect(renderResetPasswordSucceededPage(null, null, EN).body).not.toContain('We removed');
  });

  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordSucceededPage(null, null, EN);
    expect(page.title).toBe('Password reset');
    expect(page.body).toContain('Your password has been reset');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(renderResetPasswordSucceededPage(null, null, EN).body)
      .toBe(`<h1>Your password has been reset</h1>
<p>Return to the application you were signing in to and sign in with your new password.</p>`);
  });
});

describe('renderResetLinkFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetLinkFailedPage(null, null, null, EN);
    expect(page.title).toBe("Can't use this link");
    expect(page.body).toContain('This link can&#39;t be used');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(renderResetLinkFailedPage(null, null, null, EN).body)
      .toBe(`<h1>This link can&#39;t be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>`);
  });

  it('offers a new link only when told where to ask for one', () => {
    expect(
      renderResetLinkFailedPage('/tenants/acme/login-actions/reset-password', null, null, EN).body,
    ).toBe(
      `<h1>This link can&#39;t be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>
<p class="links">
<a href="/tenants/acme/login-actions/reset-password">Request a new link</a>
</p>`,
    );
  });

  it('reads French, and English for what the fixture lacks', () => {
    const page = renderResetLinkFailedPage(null, null, null, FRENCH);
    expect(page.body).toContain('<h1>Ce lien n&#39;est pas utilisable</h1>');
    expect(page.body).toContain(en['reset.linkFailed.reason']);
  });
});

describe('the reset pages a mailed link opens, with the way back it carried', () => {
  const way = '/tenants/acme/protocol/openid-connect/auth?client_id=c&state=x';
  const back =
    '<a href="/tenants/acme/protocol/openid-connect/auth?client_id=c&amp;state=x">Back to sign in</a>';

  it('keeps the way back out of the form: it is held on the server, beside the token', () => {
    expect(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'k',
        'required',
        RULES,
        EN,
      ).body,
    ).not.toContain('return_to');
    expect(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'k',
        undefined,
        RULES,
        EN,
      ).body,
    ).not.toContain('return_to');
  });

  it('links back from the done page and beside the new-link one on the failed page', () => {
    expect(renderResetPasswordSucceededPage(way, null, EN).body)
      .toBe(`<h1>Your password has been reset</h1>
<p>Sign in with your new password.</p>
<p class="links">
<a href="/tenants/acme/protocol/openid-connect/auth?client_id=c&amp;state=x">Continue to sign in</a>
</p>`);
    const failed = renderResetLinkFailedPage(
      '/tenants/acme/login-actions/reset-password',
      way,
      null,
      EN,
    ).body;
    expect(failed).toContain('Request a new link</a>\n' + back);
    expect(renderResetLinkFailedPage(null, null, null, EN).body).not.toContain('links');
  });
});

describe('the way back to an application', () => {
  const href = 'https://app.example/after?action_status=success';

  it('is offered by the page a reset ends on, and by one that cannot be used', () => {
    expect(renderResetPasswordSucceededPage(null, href, EN).body).toContain(
      '<a href="https://app.example/after?action_status=success">Return to the application</a>',
    );
    expect(renderResetPasswordSucceededPage(null, null, EN).body).not.toContain('<a ');
    expect(renderResetLinkFailedPage(null, null, href, EN).body).toContain(
      'Return to the application</a>',
    );
  });
});
