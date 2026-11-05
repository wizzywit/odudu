import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import {
  renderPasskeyEnrolmentPage,
  type PasskeyEnrolmentOffer,
} from '#/view/passkey-enrolment-html';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'passkey.title': 'Ajouter une clé d’accès',
    'passkey.nameLabel': 'Nommez cette clé',
    'passkey.namePlaceholder': 'Clé d’accès',
    'passkey.submit': 'Ajouter',
    'passkey.failed': 'Votre appareil n’a pas terminé l’ajout ("a" & "b") : {reason}. Réessayez.',
    'refusal.passkeyNotAdded': 'Cette clé n’a pas pu être ajoutée.',
  });
});

const OFFER: PasskeyEnrolmentOffer = {
  options: {
    rp: { name: 'acme', id: 'id.example.com' },
    user: { id: 'c3ViamVjdA', name: 'ada', displayName: 'ada' },
    challenge: 'Q0hBTExFTkdF',
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: [{ id: 'ZXhpc3Rpbmc', type: 'public-key' }],
  },
};

// What a browser makes of an attribute value: the five entities the renderer writes.
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('renderPasskeyEnrolmentPage', () => {
  it('carries the creation options and the field the ceremony fills in', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).toContain('"challenge":"Q0hBTExFTkdF"');
    expect(page).toContain('name="credential"');
    expect(page).toContain('value="auth-session-1"');
    expect(page).toContain(
      'action="/tenants/acme/login-actions/required-action?action=configure-passkey"',
    );
  });

  // Only the browser can produce a registration response, so a page that
  // did not emit the call is a page nobody can enrol from.
  it('[WEBAUTHN2-7.1.2-01] emits the ceremony itself, and a path for a refusal', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).toContain('navigator.credentials.create');
    expect(page).toContain('excludeCredentials');
    expect(page).toContain('catch (caught)');
    expect(page).toContain('<noscript>');
  });

  // A refused script is invisible in a response, so the only checkable half
  // is that the page and the policy sent with it name the same nonce. The
  // page returns the nonce it used rather than being handed one, which is
  // what makes them impossible to diverge.
  it('carries the nonce it reports, freshly per render', () => {
    const first = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    const second = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(first.script?.nonce).toBeDefined();
    expect(first.html).toContain(`<script nonce="${String(first.script?.nonce)}">`);
    expect(first.script?.nonce).not.toBe(second.script?.nonce);
  });

  // The options are inline on this page, so its script asks for nothing —
  // and a directive licensing a request nobody makes has stopped describing
  // the page.
  it('reports that its script fetches nothing', () => {
    expect(
      renderPasskeyEnrolmentPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'auth-session-1',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      ).script,
    ).toMatchObject({
      fetchesSameOrigin: false,
    });
  });

  it('bounds what can be typed into the label', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).toContain('name="label"');
    expect(page).toContain('maxlength="64"');
  });

  it('escapes the tenant and the session id', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme"><script>',
      pathAddress('https://idp.example', 'acme"><script>'),
      'session"><script>',
      OFFER,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).not.toContain('"><script>');
    expect(page).toContain('&lt;script&gt;');
  });

  it('keeps the English markup exactly, apart from the script, which is checked below', () => {
    const { body } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'sess-1',
      OFFER,
      'passkey_not_added',
      DEFAULT_PAGE_LOCALE,
    );
    expect(body.slice(0, body.indexOf('<script'))).toBe(`<header class="intro">
<h1>Add a passkey</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That passkey could not be added. Try again.</li>
</ul>
</div>
<p>Your device will ask you to confirm. Nothing is stored until it does.</p>
<form method="post" action="/tenants/acme/login-actions/required-action?action=configure-passkey" id="passkey-form" data-failed="Your device did not finish adding the passkey — {reason}. You can try again." data-cancelled="the request was cancelled">
  <input type="hidden" name="auth_session_id" value="sess-1">
  <input type="hidden" name="credential" id="passkey-credential">
  <label>Name this passkey <input type="text" name="label" placeholder="Passkey" maxlength="64"></label>
  <button type="submit" id="passkey-submit">Add passkey</button>
</form>
<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>Adding a passkey needs JavaScript, because only the browser can talk to your authenticator.</p></noscript>
`);
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const page = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's1',
      OFFER,
      'passkey_not_added',
      FRENCH,
    );
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Ajouter une clé d’accès');
    expect(page.body).toContain('<li id="form-error-0">Cette clé n’a pas pu être ajoutée.</li>');
    expect(page.body).toContain('<label>Nommez cette clé <input');
    expect(page.body).toContain('placeholder="Clé d’accès"');
    expect(page.body).toContain('>Ajouter</button>');
    expect(page.body).toContain(`<p>${en['passkey.intro']}</p>`);
    expect(page.script).toMatchObject({ fetchesSameOrigin: false });
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderPasskeyEnrolmentPage(
        'a',
        pathAddress('https://idp.example', 'a'),
        's',
        OFFER,
        undefined,
        ARABIC,
      ).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });

  it('holds a hostile tenant or session id inside its attribute, in both languages', () => {
    for (const locale of [DEFAULT_PAGE_LOCALE, FRENCH]) {
      const { body } = renderPasskeyEnrolmentPage(
        '"><img src=x onerror=1>',
        pathAddress('https://idp.example', '"><img src=x onerror=1>'),
        '"><img src=x onerror=1>',
        OFFER,
        undefined,
        locale,
      );
      expect(body.slice(0, body.indexOf('<script'))).not.toContain('<img');
    }
  });

  describe('the script, run against a stand-in page', () => {
    // Runs the rendered script, presses the button and lets the browser
    // refuse with `thrown`; answers what the person is then told.
    async function failureShown(locale: typeof FRENCH, thrown: Error): Promise<string> {
      const { body } = renderPasskeyEnrolmentPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'sid',
        OFFER,
        undefined,
        locale,
      );
      const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/u.exec(body)?.[1] ?? '';
      const data = (name: string): string =>
        unescapeAttribute(new RegExp(`${name}="([^"]*)"`, 'u').exec(body)?.[1] ?? '');
      const failure = { textContent: '', hidden: true };
      const handlers: ((event: { preventDefault(): void }) => Promise<void>)[] = [];
      const form = {
        dataset: { failed: data('data-failed'), cancelled: data('data-cancelled') },
        addEventListener: (_: string, handler: (typeof handlers)[number]) => handlers.push(handler),
        submit: () => undefined,
      };
      const elements: Record<string, unknown> = {
        'passkey-form': form,
        'passkey-credential': { value: '' },
        'passkey-error': failure,
      };
      runInNewContext(code, {
        document: { getElementById: (id: string) => elements[id] },
        atob,
        Uint8Array,
        navigator: { credentials: { create: () => Promise.reject(thrown) } },
      });
      await handlers[0]?.({ preventDefault: () => undefined });
      return failure.textContent;
    }

    it('says the sentence with the browser reason in it', async () => {
      expect(await failureShown(DEFAULT_PAGE_LOCALE, new Error('timed out'))).toBe(
        'Your device did not finish adding the passkey — timed out. You can try again.',
      );
    });

    it('says the page-language sentence, and the cancelled reason when there is none', async () => {
      expect(await failureShown(FRENCH, new Error(''))).toBe(
        'Votre appareil n’a pas terminé l’ajout ("a" & "b") : the request was cancelled. Réessayez.',
      );
    });

    it('cannot be mangled by a reason holding replacement patterns', async () => {
      expect(await failureShown(DEFAULT_PAGE_LOCALE, new Error("$& $1 $' $`"))).toBe(
        "Your device did not finish adding the passkey — $& $1 $' $`. You can try again.",
      );
    });

    it('holds no sentence of its own', () => {
      const { body } = renderPasskeyEnrolmentPage(
        'a',
        pathAddress('https://idp.example', 'a'),
        's',
        OFFER,
        undefined,
        DEFAULT_PAGE_LOCALE,
      );
      const script = body.slice(body.indexOf('<script'));
      expect(script).not.toMatch(/Your device|request was cancelled|try again/iu);
    });
  });

  // HTML escaping does not apply inside a <script>, where the parser reads
  // text: a tenant name carrying `</script>` would otherwise end the element
  // early and leave the rest of the options as markup.
  it('neutralises a value that would close the script element', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      {
        options: { ...OFFER.options, rp: { name: '</script><script>alert(1)</script>', id: 'x' } },
      },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).not.toContain('</script><script>alert(1)');
    expect(page).toContain('\\u003c/script');
  });

  it('escapes the JSON line terminators JavaScript does not allow raw', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'auth-session-1',
      {
        options: {
          ...OFFER.options,
          rp: { name: `line${String.fromCharCode(0x2028)}break`, id: 'x' },
        },
      },
      undefined,
      DEFAULT_PAGE_LOCALE,
    );

    expect(page).not.toContain(String.fromCharCode(0x2028));
    expect(page).toContain('line\\u2028break');
  });
});
