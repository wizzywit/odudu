import { DEFAULT_PAGE_LOCALE } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { renderConsentPage } from '#/view/consent-html';
import { en, t } from '#/view/messages';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'consent.title': 'Autoriser l’accès ?',
    'consent.heading': '{client} demande l’accès',
    'consent.link.about': 'À propos de {client}',
    'consent.link.privacy': 'Politique de confidentialité',
    'consent.scope.offlineAccess': '{label} : accès continu, même en votre absence',
    'consent.allow': 'Autoriser',
  });
});

const BASE = {
  tenant: 'acme',
  authSessionId: 'session-id',
  clientName: 'Acme Dashboard',
  clientPages: { clientUri: null, policyUri: null, tosUri: null },
  defaultScopes: ['openid', 'profile'],
  optionalScopes: ['offline_access', 'email'],
  alreadyGranted: ['email'],
  scopeLabels: {},
};

describe('renderConsentPage', () => {
  it('[ODUDU-THEME-CLIENTNAME-01] names the client in the heading of the page', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('<header class="intro">');
    expect(page.body).toMatch(/<h1>[^]*Acme Dashboard[^]*<\/h1>/u);
  });

  it('escapes a hostile client name and never emits the raw form', () => {
    const page = renderConsentPage(
      { ...BASE, clientName: '<script>alert(1)</script>' },
      DEFAULT_PAGE_LOCALE,
    );
    // A test that only asserts the escaped form is present would also pass
    // against a page that emits both the escaped and the raw string — the
    // negative assertion is what proves the raw markup never reaches the
    // document.
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.html).not.toContain('<script>alert(1)</script>');
  });

  it('links each page the client registered, escaped, and no other', () => {
    const page = renderConsentPage(
      {
        ...BASE,
        clientPages: {
          clientUri: 'https://acme.example/?a=1&b="x"',
          policyUri: null,
          tosUri: 'https://acme.example/terms',
        },
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('<a href="https://acme.example/?a=1&amp;b=&quot;x&quot;">');
    expect(page.body).toContain('<a href="https://acme.example/terms">Terms of service</a>');
    expect(page.body).not.toContain('Privacy policy');
    expect(page.script).toBeNull();
  });

  it('renders no link at all for a client that registered no page', () => {
    expect(renderConsentPage(BASE, DEFAULT_PAGE_LOCALE).body).not.toContain('<a ');
  });

  it('lists every default scope without a checkbox', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    for (const scope of BASE.defaultScopes) {
      expect(page.body).toContain(scope);
    }
    // Would still pass if a default scope also got a checkbox rendered
    // beside it under a different attribute name, so pin the absence of
    // any input named after a default scope.
    expect(page.body).not.toMatch(/<input[^>]*value="openid"/);
    expect(page.body).not.toMatch(/<input[^>]*value="profile"/);
  });

  it('gives every optional scope a checkbox, pre-ticked when already granted', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    // offline_access was not granted: present as a checkbox, not checked.
    expect(page.body).toMatch(/<input type="checkbox" name="scope" value="offline_access">/);
    // email was granted: same checkbox, but checked — a test asserting only
    // the unchecked pattern would pass even if every scope came pre-ticked.
    expect(page.body).toMatch(/<input type="checkbox" name="scope" value="email" checked>/);
    expect(page.body).not.toMatch(
      /<input type="checkbox" name="scope" value="offline_access" checked>/,
    );
  });

  // OIDC Core §16.18: "the authorization server clearly identifies
  // long-term grants to the user during authorization" — merely listing
  // offline_access alongside every other optional scope would not satisfy
  // this, so pin the distinguishing text rather than just the checkbox.
  it('[OIDC-CORE-16.18-01] identifies offline_access as a long-term grant, not just another optional scope', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.body).toMatch(/<bdi>offline_access<\/bdi>[^<]*ongoing access/);
    // A scope with no such note (email) proves the distinction is drawn
    // deliberately, not emitted for every optional scope alike.
    expect(page.body).not.toMatch(/email[^<]*ongoing access/);
  });

  it('gives Allow and Deny distinguishable submitted values', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.body).toMatch(/<button type="submit" name="decision" value="allow">/);
    expect(page.body).toMatch(
      /<button type="submit" name="decision" value="deny" class="secondary">/,
    );
    // Same name, different value: a form that instead rendered two buttons
    // both named "decision" with the same value would satisfy a looser
    // check, so pin both values distinctly.
  });

  it('carries auth_session_id as a hidden field', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('<input type="hidden" name="auth_session_id" value="session-id">');
  });

  it('renders no script, matching a null CSP script directive', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.script).toBeNull();
    expect(page.body).not.toContain('<script');
  });

  it('returns a body fragment and a title beside the document', () => {
    const page = renderConsentPage(BASE, DEFAULT_PAGE_LOCALE);
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });

  it('shows a scope by its consent text, escaped, and posts its name', () => {
    const page = renderConsentPage(
      {
        ...BASE,
        scopeLabels: { profile: 'Your <name> & "picture"', email: 'Your address' },
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('<li><bdi>Your &lt;name&gt; &amp; &quot;picture&quot;</bdi></li>');
    expect(page.body).toContain('value="email" checked> <bdi>Your address</bdi></label>');
    expect(page.body).toContain('<li><bdi>openid</bdi></li>');
    expect(page.body).not.toContain('<name>');
    expect(page.script).toBeNull();
  });

  it('keeps the English markup, each user-controlled value isolated', () => {
    expect(renderConsentPage(BASE, DEFAULT_PAGE_LOCALE).body).toBe(
      `<header class="intro">
<h1><bdi>Acme Dashboard</bdi> is asking for access</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<form method="post" action="/tenants/acme/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="session-id">
  <ul>
  <li><bdi>openid</bdi></li>
  <li><bdi>profile</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> <bdi>offline_access</bdi> — grants ongoing access, even while you are not present</label>
  <label><input type="checkbox" name="scope" value="email" checked> <bdi>email</bdi></label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>`,
    );
  });

  it('shows every visible string as the catalogue says it', () => {
    const page = renderConsentPage(
      {
        ...BASE,
        clientPages: {
          clientUri: 'https://a.example/',
          policyUri: 'https://a.example/p',
          tosUri: 'https://a.example/t',
        },
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.html).toContain('<html lang="en" dir="ltr">');
    expect(page.title).toBe(en['consent.title']);
    expect(page.body).toContain(`>${en['consent.link.privacy']}</a>`);
    expect(page.body).toContain(`>${en['consent.link.terms']}</a>`);
    expect(page.body).toContain(`>${en['consent.allow']}</button>`);
    expect(page.body).toContain(`>${en['consent.deny']}</button>`);
    expect(page.body).toContain(
      `<bdi>offline_access</bdi>${t(DEFAULT_PAGE_LOCALE, 'consent.scope.offlineAccess', { label: 'offline_access' }).slice('offline_access'.length)}`,
    );
  });

  it('reads French through the same renderer and falls back per key', () => {
    const page = renderConsentPage(
      {
        ...BASE,
        clientPages: {
          clientUri: 'https://a.example/',
          policyUri: 'https://a.example/p',
          tosUri: 'https://a.example/t',
        },
      },
      FRENCH,
    );
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Autoriser l’accès ?');
    expect(page.body).toContain('<h1><bdi>Acme Dashboard</bdi> demande l’accès</h1>');
    expect(page.body).toContain('>À propos de <bdi>Acme Dashboard</bdi></a>');
    expect(page.body).toContain('>Politique de confidentialité</a>');
    expect(page.body).toContain('<bdi>offline_access</bdi> : accès continu, même en votre absence');
    expect(page.body).toContain('value="allow">Autoriser</button>');
    // Not in the French fixture: English shows for these two keys.
    expect(page.body).toContain('>Terms of service</a>');
    expect(page.body).toContain('value="deny" class="secondary">Deny</button>');
    expect(renderConsentPage(BASE, ARABIC).html).toContain('<html lang="ar" dir="rtl">');
  });

  it('keeps a hostile client name, scope label and link inside their own elements', () => {
    const hostile = '</bdi><img src=x onerror=1>"\'><script>1</script>';
    for (const locale of [DEFAULT_PAGE_LOCALE, FRENCH]) {
      const page = renderConsentPage(
        {
          ...BASE,
          clientName: hostile,
          clientPages: { clientUri: 'https://a.example/', policyUri: null, tosUri: null },
          scopeLabels: { profile: hostile, offline_access: hostile },
        },
        locale,
      );
      const escaped =
        '&lt;/bdi&gt;&lt;img src=x onerror=1&gt;&quot;&#39;&gt;&lt;script&gt;1&lt;/script&gt;';
      expect(page.html).toContain(`<h1><bdi>${escaped}</bdi>`);
      expect(page.html).toContain(`<li><bdi>${escaped}</bdi></li>`);
      expect(page.html).toContain(`<bdi>${escaped}</bdi> `);
      expect(page.html).not.toMatch(/<img|<script/u);
      expect(page.html.match(/<\/bdi>/gu)).toHaveLength(page.html.match(/<bdi>/gu)?.length ?? 0);
    }
  });
  describe('text in the page language', () => {
    const I18N = {
      clientName: { fr: 'Tableau Acme' },
      scopeLabels: { profile: { fr: 'Votre profil' }, email: { fr: 'Votre <adresse>' } },
    };

    it('shows the French client name and scope text for a fr page', () => {
      const page = renderConsentPage(
        { ...BASE, scopeLabels: { profile: 'Your profile' }, i18n: I18N },
        FRENCH,
      );
      expect(page.body).toContain('<h1><bdi>Tableau Acme</bdi> demande l’accès</h1>');
      expect(page.body).toContain('<li><bdi>Votre profil</bdi></li>');
      expect(page.body).not.toContain('Acme Dashboard');
    });

    it('uses the base text for a locale with no entry', () => {
      const page = renderConsentPage(
        { ...BASE, scopeLabels: { profile: 'Your profile' }, i18n: I18N },
        DEFAULT_PAGE_LOCALE,
      );
      expect(page.body).toContain('<bdi>Acme Dashboard</bdi>');
      expect(page.body).toContain('<li><bdi>Your profile</bdi></li>');
      expect(page.body).not.toContain('Tableau');
    });

    it('matches a regional page to the language by lookup', () => {
      const page = renderConsentPage({ ...BASE, i18n: I18N }, { tag: 'fr-CA', dir: 'ltr' });
      expect(page.body).toContain('<bdi>Tableau Acme</bdi>');
    });

    it('escapes a localised name and scope text like every other value', () => {
      const hostile = '</bdi><img src=x onerror=1><script>1</script>';
      const page = renderConsentPage(
        {
          ...BASE,
          clientPages: { clientUri: 'https://a.example/', policyUri: null, tosUri: null },
          i18n: { clientName: { fr: hostile }, scopeLabels: { email: { fr: hostile } } },
        },
        FRENCH,
      );
      expect(page.html).not.toMatch(/<img|<script/u);
      expect(page.html).toContain('&lt;img src=x onerror=1&gt;');
      expect(page.html.match(/<\/bdi>/gu)).toHaveLength(page.html.match(/<bdi>/gu)?.length ?? 0);
    });
  });
});
