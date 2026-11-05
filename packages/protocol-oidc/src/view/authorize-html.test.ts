import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { en } from '#/view/messages';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'error.title': 'Erreur de connexion',
    'error.heading': 'Impossible de continuer',
    'error.wayOn.restart': 'Recommencer la connexion',
    'login.title': 'Se connecter',
    'login.submit': 'Se connecter',
    'login.username': 'Nom d’utilisateur',
    'login.password': 'Mot de passe',
    'login.context': 'pour continuer vers {client}',
    'login.rememberMe': 'Se souvenir de moi',
    'login.passkey.submit': 'Se connecter avec une clé d’accès',
    'login.passkey.failed': 'Votre appareil n’a pas terminé la connexion : {reason}. Réessayez.',
    'login.refusal.signInFailed': 'Échec de la connexion. Vérifiez vos informations.',
    'emailUnverified.body':
      'Vérifiez votre adresse e-mail. {mail, select, sent {Un lien a été envoyé.} other {Aucune adresse.}}',
  });
});

// What a browser makes of an attribute value: the five entities the renderer writes.
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('renderAuthorizeErrorPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderAuthorizeErrorPage(
      'invalid_request',
      'missing redirect_uri',
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe('Sign-in error');
    expect(page.body).toContain('invalid_request');
    // The fragment is a fragment: a theme that wraps it must not find a
    // second document inside it.
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    // The assembled document still carries everything it carries today.
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});

describe('renderAuthorizeErrorPage with a way on', () => {
  it('offers a restart link to the given location, and carries no script', () => {
    const page = renderAuthorizeErrorPage(
      'invalid_request',
      'expired',
      {
        kind: 'restart',
        href: '/tenants/acme/auth?a=1',
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('<a href="/tenants/acme/auth?a=1">Start sign-in again</a>');
    expect(page.script).toBeNull();
    expect(page.body).not.toContain('<script');
  });

  it('offers a return to the application under its own label', () => {
    const page = renderAuthorizeErrorPage(
      'invalid_request',
      'expired',
      {
        kind: 'return',
        href: 'https://app.example/cb?error=access_denied',
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(
      '<a href="https://app.example/cb?error=access_denied">Return to the application</a>',
    );
    expect(page.body).not.toContain('Start sign-in again');
  });

  it('escapes the location it was given', () => {
    const page = renderAuthorizeErrorPage(
      'invalid_request',
      'x',
      {
        kind: 'restart',
        href: '/auth?a=1&b="><script>x</script>',
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('href="/auth?a=1&amp;b=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(page.body).not.toContain('<script');
  });

  it('offers no link when there is nothing to go on to', () => {
    expect(
      renderAuthorizeErrorPage('invalid_request', 'x', undefined, DEFAULT_PAGE_LOCALE).body,
    ).not.toContain('<a ');
  });
});

describe('renderEmailUnverifiedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderEmailUnverifiedPage(true, null, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Verify your email');
    expect(page.body).toContain('verify your email');
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});

describe('renderLoginForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'password',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe('Sign in');
    expect(page.body).toContain('name="username"');
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });

  it('titles the second-factor form for what it asks, not as a second sign-in', () => {
    const otp = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'otp',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(otp.title).toBe('Enter your authentication code');
    expect(otp.body).toContain('name="code"');
    expect(otp.body).toContain('<button type="submit">Verify</button>');
    expect(otp.body).not.toContain('Sign in');
    const recovery = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'recovery-code',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(recovery.title).toBe('Enter a recovery code');
    expect(recovery.body).toContain('<button type="submit">Verify</button>');
  });

  it('offers remember me when the tenant allows it', () => {
    const page = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'password',
      false,
      true,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(
      '<input type="checkbox" name="remember_me" id="remember-me" value="true">',
    );
    expect(page.body).toContain('Remember me');
  });

  it('offers nothing when the tenant does not allow it', () => {
    const page = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'password',
      false,
      false,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).not.toContain('remember_me');
  });

  // The tenant name is the one request-derived value this page interpolates
  // into markup at all — the form's own `action` — so it is escaped like any
  // other. Exercised here directly against the pure renderer rather than
  // through a stored tenant, since a name shaped like this can no longer
  // reach a row (tenants_name_dns_label,
  // packages/db/drizzle/0072_tenant_name_rule.sql).
  it('escapes a tenant name that is not a DNS label', () => {
    const page = renderLoginForm(
      'esc"><script>alert(1)<x',
      pathAddress('https://idp.example', 'esc"><script>alert(1)<x'),
      'session-id',
      'password',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).not.toContain('<script>');
    expect(page.body).toContain('&lt;script&gt;');
    expect(page.body).toContain('&quot;&gt;');
  });

  it('sets the passkey button in a paragraph, clear of the sign-in button', () => {
    const page = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sid',
      'password',
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(
      '<p><button type="submit" id="passkey-submit" class="secondary">Sign in with a passkey</button></p>',
    );
  });

  it('opens with the page heading and the tenant, as a heading the person can find', () => {
    const body = renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sid',
      'otp',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    ).body;
    expect(body.startsWith('<header class="intro">\n<h1>Enter your authentication code</h1>')).toBe(
      true,
    );
    expect(body).toContain('<p class="tenant"><bdi>acme</bdi></p>');
    expect(body.match(/<h1>/gu)).toHaveLength(1);
  });

  describe('naming the client the request is for', () => {
    const render = (client: string | undefined, locale: typeof FRENCH = DEFAULT_PAGE_LOCALE) =>
      renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        undefined,
        false,
        client,
        {},
        locale,
      ).body;

    it('says where the person is going, isolated, between the heading and the tenant', () => {
      const body = render('Acme Portal');
      expect(body).toContain(
        '<h1>Sign in</h1>\n<p class="context">to continue to <bdi>Acme Portal</bdi></p>\n<p class="tenant">',
      );
    });

    it('says nothing of a client when the request names none', () => {
      expect(render(undefined)).not.toContain('class="context"');
    });

    it('reads the sentence in the language of the page', () => {
      expect(render('Acme Portal', FRENCH)).toContain(
        '<p class="context">pour continuer vers <bdi>Acme Portal</bdi></p>',
      );
    });

    it('holds a hostile client name inside its own element', () => {
      const body = render('<img src=x onerror=1>\u202e');
      expect(body).not.toContain('<img');
      expect(body).toContain('<bdi>&lt;img src=x onerror=1&gt;\u202e</bdi>');
    });
  });

  describe('after a refusal', () => {
    const refusal = { messageId: 'login.refusal.signInFailed' } as const;

    it('puts the message in an alert above the form', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'session-id',
        'password',
        false,
        false,
        refusal,
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body).toContain(`<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Sign-in failed. Check your details and try again.</li>
</ul>
</div>
<form`);
      expect(page.body.indexOf('role="alert"')).toBeLessThan(page.body.indexOf('<form'));
    });

    it('shows no alert without a refusal', () => {
      expect(
        renderLoginForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'session-id',
          'password',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {},
          DEFAULT_PAGE_LOCALE,
        ).body,
      ).not.toContain('role="alert"');
    });

    it('reads the message from the catalogue by its id, in the language of the page', () => {
      const render = (locale: typeof FRENCH) =>
        renderLoginForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'sid',
          'password',
          false,
          false,
          refusal,
          undefined,
          undefined,
          {},
          locale,
        );
      expect(render(DEFAULT_PAGE_LOCALE).body).toContain(
        `<li id="form-error-0">${en['login.refusal.signInFailed']}</li>`,
      );
      expect(render(FRENCH).body).toContain(
        '<li id="form-error-0">Échec de la connexion. Vérifiez vos informations.</li>',
      );
    });

    it('gives the username back and moves focus to the empty password field', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        {
          ...refusal,
          username: 'ada',
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body).toContain('name="username" autocomplete="username" value="ada"');
      expect(page.body).toMatch(/name="password"[^>]*autofocus/u);
      expect(page.body).not.toMatch(/name="username"[^>]*autofocus/u);
    });

    it('focuses the username when there is none to give back', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        refusal,
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body).toMatch(/name="username"[^>]*autofocus/u);
      expect(page.body).not.toContain('value=""');
    });

    it('never puts anything but the username into a value attribute', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        true,
        {
          ...refusal,
          username: 'ada',
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body.match(/ value="[^"]*"/gu)).toEqual([
        ' value="sid"',
        ' value="ada"',
        ' value="true"',
      ]);
    });

    it.each([
      ['a double quote', 'a"b'],
      ['a single quote', "a'b"],
      ['a tag', '<b>x</b>'],
      ['an ampersand', 'a&amp;b'],
      ['a closing script', '</script><script>alert(1)</script>'],
      ['unicode', 'Zoë 名前 🙂'],
      ['a bidi override', 'ada\u202Eevil'],
    ])('escapes %s in the username it gives back', (_name, username) => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        {
          ...refusal,
          username,
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      const echoed = /name="username"[^>]* value="([^"]*)"/u.exec(page.body)?.[1] ?? '';
      expect(echoed).not.toMatch(/[<>"']/u);
      expect(page.body).not.toContain('<script');
      expect(page.body).not.toContain('<b>');
      expect(
        echoed
          .replaceAll('&amp;', '&')
          .replaceAll('&#39;', "'")
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&quot;', '"'),
      ).toBe(username);
    });

    it.each([
      ['254 code points of one unit each', 'a'.repeat(254), true],
      ['255 code points of one unit each', 'a'.repeat(255), false],
      ['254 code points of two units each', '\u{1F642}'.repeat(254), true],
      ['255 code points of two units each', '\u{1F642}'.repeat(255), false],
    ])('counts code points at the echo bound: %s', (_label, username, echoed) => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        {
          ...refusal,
          username,
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body.includes(`value="${username}"`)).toBe(echoed);
    });

    it('does not echo an empty username as an empty value', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        {
          ...refusal,
          username: '',
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body).not.toContain('value=""');
      expect(page.body).toMatch(/name="username"[^>]*autofocus/u);
    });

    it('does not reflect a very long username', () => {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        {
          ...refusal,
          username: 'a'.repeat(1_000_000),
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.html.length).toBeLessThan(5_000);
      expect(page.body).toContain('role="alert"');
      expect(page.body).toMatch(/name="username"[^>]*autofocus/u);
    });

    it('asks for a code with focus on the code field, and gives back nothing', () => {
      const otp = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'otp',
        false,
        false,
        {
          messageId: 'login.refusal.codeFailed',
          username: 'ada',
        },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(otp.body).toMatch(/name="code"[^>]*autofocus/u);
      expect(otp.body.match(/autofocus/gu)).toHaveLength(1);
      expect(otp.body).not.toContain('ada');
      const recovery = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'recovery-code',
        false,
        false,
        { messageId: 'login.refusal.recoveryCodeFailed' },
        undefined,
        undefined,
        {},
        DEFAULT_PAGE_LOCALE,
      );
      expect(recovery.body).toMatch(/name="recovery_code"[^>]*autofocus/u);
    });

    it('does not focus a field when nothing was refused', () => {
      expect(
        renderLoginForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'sid',
          'password',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {},
          DEFAULT_PAGE_LOCALE,
        ).body,
      ).not.toContain('autofocus');
      expect(
        renderLoginForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'sid',
          'otp',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {},
          DEFAULT_PAGE_LOCALE,
        ).body,
      ).not.toContain('autofocus');
    });
  });
});

describe('the text of the sign-in pages', () => {
  const login = (form: string, locale: typeof FRENCH, passkey = false) =>
    renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sid',
      form,
      passkey,
      true,
      undefined,
      true,
      undefined,
      {},
      locale,
    );

  it('keeps the English markup of the password form', () => {
    expect(login('password', DEFAULT_PAGE_LOCALE).body).toBe(
      `<header class="intro">
<h1>Sign in</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<form method="post" action="/tenants/acme/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="sid">
  <label>Username or email <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <label><input type="checkbox" name="remember_me" id="remember-me" value="true"> Remember me</label>
  <button type="submit">Sign in</button>
</form>`,
    );
  });

  it('shows every visible string as the catalogue says it', () => {
    const otp = login('otp', DEFAULT_PAGE_LOCALE);
    expect(otp.title).toBe(en['login.otp.title']);
    expect(otp.body).toContain(`<label>${en['login.otp.code']} <input`);
    expect(otp.body).toContain(`<label>${en['login.recoveryCode.label']} <input`);
    expect(otp.body).toContain(`>${en['login.verify']}</button>`);
    expect(login('recovery-code', DEFAULT_PAGE_LOCALE).title).toBe(en['login.recoveryCode.title']);
    expect(login('password', DEFAULT_PAGE_LOCALE).title).toBe(en['login.title']);
    expect(login('password', DEFAULT_PAGE_LOCALE).html).toContain('<html lang="en" dir="ltr">');
    const withPasskey = login('password', DEFAULT_PAGE_LOCALE, true).body;
    expect(withPasskey).toContain(`>${en['login.passkey.submit']}</button>`);
    expect(withPasskey).toContain(`<noscript><p>${en['login.passkey.needsScript']}</p></noscript>`);
    expect(login('x-new', DEFAULT_PAGE_LOCALE).body).toContain(
      '<p>Unsupported sign-in step: x-new</p>',
    );
  });

  it('reads French through the same renderer and falls back per key', () => {
    const page = login('password', FRENCH);
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Se connecter');
    expect(
      renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        undefined,
        false,
        undefined,
        {},
        FRENCH,
      ).body,
    ).toContain('<label>Nom d’utilisateur <input');
    expect(page.body).toContain('Se souvenir de moi</label>');
    expect(page.body).toContain('<button type="submit">Se connecter</button>');
    // Not in the French fixture: the label with the email wording is English.
    expect(page.body).toContain('<label>Username or email <input');
    expect(login('password', ARABIC).html).toContain('<html lang="ar" dir="rtl">');
  });

  it('hands the passkey script its sentences in the page language, and no sentence is in the script', () => {
    const en1 = login('password', DEFAULT_PAGE_LOCALE, true);
    expect(en1.body).toContain(
      'data-failed="Your device did not finish signing in — {reason}. You can try again."',
    );
    expect(en1.body).toContain('data-cancelled="the request was cancelled"');
    expect(en1.body).toContain('data-not-offered="this server is not offering passkeys"');
    const script = en1.body.slice(en1.body.indexOf('<script'));
    expect(script).not.toMatch(/Your device|request was cancelled|not offering/u);
    const fr = login('password', FRENCH, true).body;
    expect(fr).toContain(
      'data-failed="Votre appareil n’a pas terminé la connexion : {reason}. Réessayez."',
    );
    expect(fr).toContain('>Se connecter avec une clé d’accès</button>');
    expect(fr).toContain('data-cancelled="the request was cancelled"');
  });

  it('keeps the English markup of the error and verification pages', () => {
    expect(
      renderAuthorizeErrorPage(
        'invalid_request',
        'expired',
        { kind: 'restart', href: '/a' },
        DEFAULT_PAGE_LOCALE,
      ).body,
    ).toBe(`<h1>Can&#39;t continue</h1>
<p><bdi>expired</bdi></p>
<p><a href="/a">Start sign-in again</a></p>
<p><small>invalid_request</small></p>`);
    expect(renderEmailUnverifiedPage(false, null, DEFAULT_PAGE_LOCALE).body).toBe(
      `<h1>Can&#39;t sign in yet</h1>
<p>You must verify your email to sign in, but this account has none. Ask an administrator.</p>`,
    );
  });

  it('reads the error and verification pages from the catalogue, in French and English', () => {
    const error = renderAuthorizeErrorPage('e', 'd', { kind: 'return', href: '/b' }, FRENCH);
    expect(error.title).toBe('Erreur de connexion');
    expect(error.body).toContain('<h1>Impossible de continuer</h1>');
    expect(error.body).toContain('>Return to the application</a>');
    expect(renderEmailUnverifiedPage(true, null, FRENCH).body).toContain(
      'Vérifiez votre adresse e-mail. Un lien a été envoyé.',
    );
    expect(renderEmailUnverifiedPage(true, null, DEFAULT_PAGE_LOCALE).title).toBe(
      en['emailUnverified.title'],
    );
  });

  it('holds a hostile error description inside its own element, in both languages', () => {
    const hostile = '</bdi><img src=x onerror=1>"\'><script>1</script>';
    for (const locale of [DEFAULT_PAGE_LOCALE, FRENCH]) {
      const page = renderAuthorizeErrorPage(hostile, hostile, undefined, locale);
      expect(page.html).toContain(
        '<bdi>&lt;/bdi&gt;&lt;img src=x onerror=1&gt;&quot;&#39;&gt;&lt;script&gt;1&lt;/script&gt;</bdi>',
      );
      expect(page.html).not.toMatch(/<img|<script/u);
    }
  });

  it('renders a username that holds markup and bidi controls inert and isolated', () => {
    // The refusal gives the username back in a value attribute, where an
    // attribute's escaping is the isolation: nothing can leave the quotes.
    const hostile = '"><img src=x onerror=1>\u202e\u2066';
    for (const locale of [DEFAULT_PAGE_LOCALE, FRENCH]) {
      const page = renderLoginForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        'password',
        false,
        false,
        { messageId: 'login.refusal.signInFailed', username: hostile },
        undefined,
        undefined,
        {},
        locale,
      );
      expect(page.html).not.toContain('<img');
      expect(page.html).toContain('value="&quot;&gt;&lt;img src=x onerror=1&gt;\u202e\u2066"');
    }
  });

  describe('the passkey script, run against a stand-in page', () => {
    interface Failure {
      textContent: string;
      hidden: boolean;
    }

    // Runs the rendered script, presses the button and lets the browser
    // refuse with `thrown`; answers what the person is then told.
    async function failureShown(locale: typeof FRENCH, thrown: Error): Promise<string> {
      const body = login('password', locale, true).body;
      const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/u.exec(body)?.[1] ?? '';
      const data = (name: string): string =>
        unescapeAttribute(new RegExp(`${name}="([^"]*)"`, 'u').exec(body)?.[1] ?? '');
      const failure: Failure = { textContent: '', hidden: true };
      const handlers: ((event: { preventDefault(): void }) => Promise<void>)[] = [];
      const form = {
        dataset: {
          failed: data('data-failed'),
          cancelled: data('data-cancelled'),
          notOffered: data('data-not-offered'),
        },
        auth_session_id: { value: 'sid' },
        addEventListener: (_: string, handler: (typeof handlers)[number]) => handlers.push(handler),
        submit: () => undefined,
      };
      const elements: Record<string, unknown> = {
        'passkey-form': form,
        'passkey-assertion': { value: '' },
        'passkey-error': failure,
      };
      runInNewContext(code, {
        document: { getElementById: (id: string) => elements[id] },
        atob,
        Uint8Array,
        URLSearchParams,
        fetch: () =>
          Promise.resolve({ ok: true, json: () => Promise.resolve({ challenge: 'AA' }) }),
        navigator: { credentials: { get: () => Promise.reject(thrown) } },
      });
      await handlers[0]?.({ preventDefault: () => undefined });
      return failure.textContent;
    }

    it('says the sentence with the browser reason in it', async () => {
      expect(await failureShown(DEFAULT_PAGE_LOCALE, new Error('timed out'))).toBe(
        'Your device did not finish signing in — timed out. You can try again.',
      );
    });

    it('says the page-language sentence, and the cancelled reason when there is none', async () => {
      expect(await failureShown(FRENCH, new Error(''))).toBe(
        'Votre appareil n’a pas terminé la connexion : the request was cancelled. Réessayez.',
      );
    });

    it('cannot be mangled by a reason holding replacement patterns', async () => {
      expect(await failureShown(DEFAULT_PAGE_LOCALE, new Error("$& $1 $' $`"))).toBe(
        "Your device did not finish signing in — $& $1 $' $`. You can try again.",
      );
    });
  });
});

describe('renderLoginForm marks what it refused', () => {
  const render = (form: string, messageId: Parameters<typeof renderLoginForm>[6]) =>
    renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sid',
      form,
      false,
      false,
      messageId,
      undefined,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    ).body;
  const INVALID = 'aria-invalid="true" aria-describedby="form-error-0"';

  it('marks both fields of a refused first factor, which cannot say which was wrong', () => {
    const body = render('password', { messageId: 'login.refusal.signInFailed' });
    expect(body).toMatch(new RegExp(`name="username"[^>]*${INVALID}`, 'u'));
    expect(body).toMatch(new RegExp(`name="password"[^>]*${INVALID}`, 'u'));
    expect(body.match(/role="alert"/gu)).toHaveLength(1);
  });

  it('marks the code, and the recovery code on its own message', () => {
    const code = render('otp', { messageId: 'login.refusal.codeFailed' });
    expect(code).toMatch(new RegExp(`name="code"[^>]*${INVALID} autofocus`, 'u'));
    expect(code).not.toMatch(/name="recovery_code"[^>]*aria-invalid/u);
    const used = render('otp', { messageId: 'login.refusal.alreadyUsedRecoveryCode' });
    expect(used).toMatch(new RegExp(`name="recovery_code"[^>]*${INVALID} autofocus`, 'u'));
    expect(used).not.toMatch(/name="code"[^>]*aria-invalid/u);
  });

  it('marks nothing on a form shown for the first time', () => {
    expect(render('password', undefined as never)).not.toContain('aria-invalid');
  });
});

describe('renderLoginForm ways on', () => {
  const render = (form: string, ways: Parameters<typeof renderLoginForm>[9]) =>
    renderLoginForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sid',
      form,
      false,
      false,
      undefined,
      undefined,
      undefined,
      ways,
      DEFAULT_PAGE_LOCALE,
    ).body;

  it('shows no links when the tenant offers neither page', () => {
    expect(render('password', {})).not.toContain('class="links"');
  });

  it('shows each link on its own, escaped, after the form', () => {
    const body = render('password', {
      resetPassword: '/tenants/acme/login-actions/reset-password?return_to=a%26b&x=<',
    });
    expect(body).toContain(
      '</form>\n<p class="links">\n<a href="/tenants/acme/login-actions/reset-password?return_to=a%26b&amp;x=&lt;">Forgot password?</a>\n</p>',
    );
    expect(body).not.toContain('Create an account');
    expect(
      render('password', { createAccount: '/tenants/acme/login-actions/registration' }),
    ).toContain('<a href="/tenants/acme/login-actions/registration">Create an account</a>');
  });

  it('puts the reset link before the registration link when both are offered', () => {
    const body = render('password', {
      createAccount: '/r',
      resetPassword: '/p',
    });
    expect(body.indexOf('Forgot password?')).toBeLessThan(body.indexOf('Create an account'));
  });

  it('offers them on the first-factor step only', () => {
    const ways = { createAccount: '/r', resetPassword: '/p' };
    expect(render('otp', ways)).not.toContain('class="links"');
    expect(render('recovery-code', ways)).not.toContain('class="links"');
  });
});

describe('renderEmailUnverifiedPage way on', () => {
  it('links back to sign-in only when the request can be rebuilt', () => {
    const way = '/tenants/acme/protocol/openid-connect/auth?client_id=c&state=x';
    expect(renderEmailUnverifiedPage(true, way, DEFAULT_PAGE_LOCALE).body).toContain(
      '<p class="links">\n<a href="/tenants/acme/protocol/openid-connect/auth?client_id=c&amp;state=x">Back to sign in</a>\n</p>',
    );
    expect(renderEmailUnverifiedPage(true, null, DEFAULT_PAGE_LOCALE).body).not.toContain(
      'Back to sign in',
    );
  });
});

describe('renderLoginForm with an unusual tenant name', () => {
  it('writes the name into every path as a segment, and into the page as text', () => {
    const page = renderLoginForm(
      'a b?"<%',
      pathAddress('https://idp.example', 'a b?"<%'),
      'sid',
      'password',
      true,
      false,
      undefined,
      false,
      undefined,
      {},
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.html).toContain('action="/tenants/a%20b%3F%22%3C%25/login-actions/authenticate"');
    expect(page.html).toContain(
      "fetch('/tenants/a%20b%3F%22%3C%25/login-actions/passkey-challenge'",
    );
    expect(page.html).toContain('<bdi>a b?&quot;&lt;%</bdi>');
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

describe('a refused sign-in form reads coherently to a screen reader', () => {
  it('has one alert, unique ids and every description present', () => {
    for (const [form, messageId] of [
      ['password', 'login.refusal.signInFailed'],
      ['otp', 'login.refusal.codeFailed'],
      ['recovery-code', 'login.refusal.recoveryCodeFailed'],
    ] as const) {
      expectCoherent(
        renderLoginForm(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'sid',
          form,
          false,
          false,
          { messageId },
          false,
          undefined,
          {},
          DEFAULT_PAGE_LOCALE,
        ).body,
      );
    }
  });
});
