import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import { renderSelectAccountPage } from '#/view/select-account-html';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'selectAccount.title': 'Choisir un compte',
    'selectAccount.useOther': 'Utiliser un autre compte',
  });
});

const base = {
  tenant: 'demo',
  address: pathAddress('https://idp.example', 'demo'),
  authSessionId: 'a-session',
  accounts: [
    { sessionId: 's1', displayName: 'alice@example.test' },
    { sessionId: 's2', displayName: 'bob@example.test' },
  ],
};

describe('renderSelectAccountPage', () => {
  it('offers one submit per live session, naming the session id', () => {
    const page = renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('value="s1"');
    expect(page.body).toContain('value="s2"');
    expect(page.body).toContain('alice@example.test');
  });

  it('offers a way to use another account', () => {
    expect(renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE).body).toContain('name="use_other"');
  });

  it('escapes a display name and never emits the raw form', () => {
    const page = renderSelectAccountPage(
      {
        ...base,
        accounts: [{ sessionId: 's1', displayName: '<script>alert(1)</script>' }],
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.html).not.toContain('<script>alert(1)</script>');
  });

  it('carries no script and declares no frames', () => {
    const page = renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE);
    expect(page.script).toBeNull();
    expect(page.frames).toEqual([]);
  });

  it('returns a title and a body that is not the whole document', () => {
    const page = renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Choose an account');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<html');
  });

  it('keeps the English markup, each account name isolated', () => {
    expect(renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE).body).toBe(
      `<header class="intro">
<h1>Choose an account</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/select-account">
  <input type="hidden" name="auth_session_id" value="a-session">
  <button type="submit" name="session_id" value="s1" class="secondary choice"><bdi>alice@example.test</bdi></button>
  <button type="submit" name="session_id" value="s2" class="secondary choice"><bdi>bob@example.test</bdi></button>
  <button type="submit" name="use_other" value="1" class="quiet">Use another account</button>
</form>`,
    );
  });

  it('shows every visible string as the catalogue says it', () => {
    const { body, title } = renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE);
    expect(title).toBe(en['selectAccount.title']);
    expect(body).toContain(`<h1>${en['selectAccount.title']}</h1>`);
    expect(body).toContain(`>${en['selectAccount.useOther']}</button>`);
    expect(renderSelectAccountPage(base, DEFAULT_PAGE_LOCALE).html).toContain(
      '<html lang="en" dir="ltr">',
    );
  });

  it('reads French through the same renderer, and right-to-left declares dir', () => {
    const page = renderSelectAccountPage(base, FRENCH);
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.body).toContain('<h1>Choisir un compte</h1>');
    expect(page.body).toContain('>Utiliser un autre compte</button>');
    expect(renderSelectAccountPage(base, ARABIC).html).toContain('<html lang="ar" dir="rtl">');
  });

  it('renders a username that holds markup and bidi controls inert and isolated', () => {
    const hostile = '<img src=x onerror=1>\u202e\u2066"evil';
    for (const locale of [DEFAULT_PAGE_LOCALE, FRENCH]) {
      const page = renderSelectAccountPage(
        { ...base, accounts: [{ sessionId: 's1', displayName: hostile }] },
        locale,
      );
      expect(page.body).toContain(
        '<bdi>&lt;img src=x onerror=1&gt;\u202e\u2066&quot;evil</bdi></button>',
      );
      expect(page.html).not.toContain('<img');
    }
  });
});
