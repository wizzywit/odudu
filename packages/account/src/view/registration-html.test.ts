import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationSucceededPage,
  type RegistrationFailure,
} from '#/view/registration-html';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'registration.title': 'Créer un compte',
    'registration.username': "Nom d'utilisateur",
    'registration.failed.title': 'Impossible de créer ce compte',
    'registration.refusal.usernameTaken': "Ce nom d'utilisateur est déjà pris.",
    'registration.succeeded.signIn': 'Vous pouvez maintenant vous connecter.',
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

// The page's script carries a nonce fresh for each response.
const withoutScript = (body: string): string =>
  body.replace(/<script nonce="[^"]*">[\s\S]*?<\/script>/gu, '<script nonce="N">…</script>');

const RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

const SIGN_IN =
  '/tenants/acme/protocol/openid-connect/auth?response_type=code&client_id=portal&state=a%20b';

describe('renderRegistrationForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe('Create account');
    expect(page.body).toContain('name="username"');
    expectFragment(page);
  });

  it('keeps the English markup exactly, with no way back when none was carried', () => {
    expect(
      withoutScript(
        renderRegistrationForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          { rules: RULES },
          DEFAULT_PAGE_LOCALE,
        ).body,
      ),
    ).toBe(`<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<form method="post" action="/tenants/acme/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="N">…</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="N">…</script>
  <button type="submit">Create account</button>
</form>`);
  });

  it('links back to sign-in and carries the way in the form', () => {
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES, signInPath: SIGN_IN },
      DEFAULT_PAGE_LOCALE,
    );
    const escaped = SIGN_IN.replaceAll('&', '&amp;');
    expect(body).toContain(`<input type="hidden" name="return_to" value="${escaped}">`);
    expect(body).toContain(`<p class="links">\n<a href="${escaped}">Back to sign in</a>\n</p>`);
  });

  it('re-renders the same form with the broken rules in one alert, the password never given back', () => {
    const failure: RegistrationFailure = {
      violations: [
        { rule: 'min-length', message: 'dev', minLength: 12 },
        { rule: 'require-digit', message: 'dev' },
      ],
    };
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES, failure, username: 'newcomer', email: 'new@example.test' },
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain(`<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 12 characters long.</li>
<li id="form-error-1">Password must contain a digit.</li>
</ul>
</div>
<form`);
    expect(body).toContain('name="username" autocomplete="username" value="newcomer">');
    expect(body).toContain('name="email" autocomplete="email" value="new@example.test">');
    expect(body).toContain(
      'name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 form-error-1 password-rules-list" autofocus>',
    );
    expect(body).not.toMatch(/name="password"[^>]*value=/u);
  });

  it('names each empty field, marks it and focuses the first', () => {
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES, failure: { missing: ['email', 'password'] }, username: 'newcomer' },
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('<li id="form-error-0">Enter an email address.</li>');
    expect(body).toContain('<li id="form-error-1">Enter a password.</li>');
    expect(body).toContain(
      'name="email" autocomplete="email" aria-invalid="true" aria-describedby="form-error-0" autofocus>',
    );
    expect(body).toContain(
      'name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-1 password-rules-list">',
    );
    expect(body).not.toMatch(/name="username"[^>]*aria-invalid/u);
  });

  it.each([
    ['username_taken', 'username', en['registration.refusal.usernameTaken']],
    ['invalid_username', 'username', en['registration.refusal.invalidUsername']],
    ['email_taken', 'email', en['registration.refusal.emailTaken']],
    ['invalid_email', 'email', en['registration.refusal.invalidEmail']],
  ] as const)('puts %s on the %s field', (refusal, field, text) => {
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES, failure: { refusal } },
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain(`<li id="form-error-0">${text}</li>`);
    expect(body).toMatch(
      new RegExp(
        `name="${field}"[^>]*aria-invalid="true" aria-describedby="form-error-0" autofocus>`,
        'u',
      ),
    );
  });

  it('escapes what it gives back and refuses a value too long to reflect', () => {
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      {
        rules: RULES,
        failure: { refusal: 'email_taken' },
        username: '"><script>1</script>',
        email: 'x'.repeat(600),
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).not.toContain('<script>1');
    expect(body).toContain('value="&quot;&gt;&lt;script&gt;1&lt;/script&gt;"');
    expect(body).not.toContain('xxxxxxxx');
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const page = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES },
      FRENCH,
    );
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Créer un compte');
    expect(page.body).toContain(`<label>Nom d&#39;utilisateur <input`);
    expect(page.body).toContain(`<label>${en['registration.email']} <input`);
    expect(page.body).toContain(`>${en['registration.submit']}</button>`);
    expect(
      renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { rules: RULES, failure: { refusal: 'username_taken' } },
        FRENCH,
      ).body,
    ).toContain('<li id="form-error-0">Ce nom d&#39;utilisateur est déjà pris.</li>');
  });

  it('shows a rule it has no wording for by its developer message, isolated and escaped', () => {
    const { body } = renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      {
        rules: RULES,
        failure: { violations: [{ rule: 'future', message: '<img src=x onerror=1>' }] },
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('<li id="form-error-0"><bdi>&lt;img src=x onerror=1&gt;</bdi></li>');
    expect(body).not.toContain('<img');
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { rules: RULES },
        ARABIC,
      ).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });

  it('writes a tenant name into the action as a path segment, and into the page as text', () => {
    const { html } = renderRegistrationForm(
      'a b?"<%',
      pathAddress('https://idp.example', 'a b?"<%'),
      { rules: RULES },
      DEFAULT_PAGE_LOCALE,
    );
    expect(html).toContain('action="/tenants/a%20b%3F%22%3C%25/login-actions/registration"');
    expect(html).toContain('<bdi>a b?&quot;&lt;%</bdi>');
    expect(html).not.toContain('<%');
  });
});

describe('renderRegistrationFailedPage', () => {
  it('stays a page for the one refusal that is not about a field, with the way to try again', () => {
    const page = renderRegistrationFailedPage(
      pathAddress('https://idp.example', 'acme'),
      null,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe("Can't create this account");
    expect(page.body).toBe(`<h1>Can&#39;t create this account</h1>
<p>Registration is temporarily unavailable. Try again later.</p>
<p class="links">
<a href="/tenants/acme/login-actions/registration">Try again</a>
</p>`);
    expectFragment(page);
  });

  it('keeps the way back through the retry and beside it', () => {
    const { body } = renderRegistrationFailedPage(
      pathAddress('https://idp.example', 'acme'),
      SIGN_IN,
      DEFAULT_PAGE_LOCALE,
    );
    const retry = `/tenants/acme/login-actions/registration?return_to=${encodeURIComponent(SIGN_IN)}`;
    expect(body).toContain(`<a href="${retry.replaceAll('&', '&amp;')}">Try again</a>`);
    expect(body).toContain(`>Back to sign in</a>`);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderRegistrationFailedPage(pathAddress('https://idp.example', 'acme'), null, ARABIC).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });
});

describe('renderRegistrationSucceededPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRegistrationSucceededPage(false, null, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Account created');
    expect(page.body).toContain('You can now sign in.');
    expectFragment(page);
  });

  it('keeps the English markup exactly, with and without verification', () => {
    expect(renderRegistrationSucceededPage(false, null, DEFAULT_PAGE_LOCALE).body)
      .toBe(`<h1>Account created</h1>
<p>You can now sign in.</p>`);
    expect(renderRegistrationSucceededPage(true, null, DEFAULT_PAGE_LOCALE).body)
      .toBe(`<h1>Check your email</h1>
<p>If this address can be registered, we sent a link to finish.</p>`);
  });

  it('links on to sign-in when the way was carried', () => {
    expect(renderRegistrationSucceededPage(false, SIGN_IN, DEFAULT_PAGE_LOCALE).body).toContain(
      `<p class="links">\n<a href="${SIGN_IN.replaceAll('&', '&amp;')}">Back to sign in</a>\n</p>`,
    );
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const page = renderRegistrationSucceededPage(false, null, FRENCH);
    expect(page.body).toContain('<p>Vous pouvez maintenant vous connecter.</p>');
    expect(page.title).toBe(en['registration.succeeded.title']);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(renderRegistrationSucceededPage(true, null, ARABIC).html).toContain(
      '<html lang="ar" dir="rtl">',
    );
  });
});

// What a screen reader is given: one alert, entry ids that are unique, and
// every field's description pointing at an entry that is there.
function expectCoherent(body: string): void {
  expect(body.match(/role="alert"/gu)?.length).toBe(1);
  const ids = [...body.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  const described = [...body.matchAll(/aria-describedby="([^"]+)"/gu)].flatMap((match) =>
    (match[1] ?? '').split(' '),
  );
  expect(described.length).toBeGreaterThan(0);
  for (const id of described) expect(ids, id).toContain(id);
}

describe('a refused registration form reads coherently to a screen reader', () => {
  it('has one alert, unique ids and every description present', () => {
    expectCoherent(
      renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        {
          rules: RULES,
          failure: {
            violations: [
              { rule: 'min-length', message: 'x', minLength: 12 },
              { rule: 'require-digit', message: 'x' },
            ],
          },
        },
        DEFAULT_PAGE_LOCALE,
      ).body,
    );
    expectCoherent(
      renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { rules: RULES, failure: { missing: ['username', 'email'] } },
        DEFAULT_PAGE_LOCALE,
      ).body,
    );
  });
});
