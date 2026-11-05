import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import {
  renderLoggedOutPage,
  renderLoggedOutRedirectPage,
  renderLogoutConfirmationPage,
  renderLogoutRedirectRefusedPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';
import { en } from '#/view/messages';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'logout.confirm.title': 'Se déconnecter ?',
    'logout.confirm.submit': 'Se déconnecter',
    'logout.done.title': 'Déconnecté',
    'logout.done.body': 'Vous avez été déconnecté.',
    'logout.unauthenticated.title': 'Déconnexion impossible',
  });
});

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderLogoutConfirmationPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutConfirmationPage(
      pathAddress('https://idp.example', 'acme'),
      'session-id',
      'the-token',
      {
        clientId: null,
        postLogoutRedirectUri: null,
        state: null,
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.title).toBe('Sign out?');
    expect(page.body).toContain('name="session_id"');
    expect(page.body).toContain('<input type="hidden" name="csrf" value="the-token">');
    expectFragment(page);
  });
});

describe('renderNoActiveSessionPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderNoActiveSessionPage(DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Already signed out');
    expect(page.body).toContain('no active session');
    expectFragment(page);
  });
});

describe('renderLoggedOutPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLoggedOutPage(undefined, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Signed out');
    expect(page.body).toContain('signed out');
    expectFragment(page);
  });

  it('frames each URL it is given, as its own iframe and its own origin', () => {
    const page = renderLoggedOutPage(
      ['https://rp-one.example/logout?iss=a', 'https://rp-two.example/logout?iss=a'],
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('<iframe src="https://rp-one.example/logout?iss=a"></iframe>');
    expect(page.body).toContain('<iframe src="https://rp-two.example/logout?iss=a"></iframe>');
    expect(page.frames).toEqual(['https://rp-one.example', 'https://rp-two.example']);
  });

  it('escapes a query character in a framed URL rather than passing it through raw', () => {
    const page = renderLoggedOutPage(['https://rp.example/logout?a=1&b=2'], DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('<iframe src="https://rp.example/logout?a=1&amp;b=2"></iframe>');
    expect(page.body).not.toContain('logout?a=1&b=2"');
  });
});

describe('renderLogoutRedirectRefusedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutRedirectRefusedPage(undefined, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Signed out');
    expect(page.body).toContain('not one this client has registered');
    expectFragment(page);
  });
});

describe('renderLogoutUnauthenticatedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutUnauthenticatedPage(DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe("Can't sign out");
    expect(page.body).toContain('no longer valid');
    expectFragment(page);
  });
});

describe('the text of every logout page', () => {
  const fields = { clientId: null, postLogoutRedirectUri: null, state: null };
  const pages = (locale: typeof FRENCH) => ({
    confirm: renderLogoutConfirmationPage(
      pathAddress('https://idp.example', 'acme'),
      'sid',
      'csrf',
      fields,
      locale,
    ),
    noSession: renderNoActiveSessionPage(locale),
    done: renderLoggedOutPage([], locale),
    refused: renderLogoutRedirectRefusedPage([], locale),
    unauthenticated: renderLogoutUnauthenticatedPage(locale),
  });

  it('keeps the English markup', () => {
    const p = pages(DEFAULT_PAGE_LOCALE);
    expect(p.confirm.body).toBe(`<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/tenants/acme/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="sid">
  <input type="hidden" name="csrf" value="csrf">
  <button type="submit">Sign out</button>
</form>`);
    expect(p.noSession.body).toBe(
      '<h1>Already signed out</h1>\n<p>There is no active session to end.</p>',
    );
    expect(p.done.body).toBe('<h1>Signed out</h1>\n<p>You have been signed out.</p>\n');
    expect(p.unauthenticated.body).toBe(
      '<h1>Can&#39;t sign out</h1>\n<p>This sign-out attempt is no longer valid. Go back and try again.</p>',
    );
  });

  it('shows every visible string as the catalogue says it, escaped', () => {
    const p = pages(DEFAULT_PAGE_LOCALE);
    expect(p.confirm.title).toBe(en['logout.confirm.title']);
    expect(p.confirm.body).toContain(en['logout.confirm.body']);
    expect(p.noSession.body).toContain(en['logout.noSession.body']);
    expect(p.refused.body).toContain(en['logout.redirectRefused.body']);
    expect(p.unauthenticated.title).toBe(en['logout.unauthenticated.title']);
    expect(p.unauthenticated.body).toContain(en['logout.unauthenticated.body']);
    expect(p.done.html).toContain('<html lang="en" dir="ltr">');
  });

  it('reads French through the same renderers and falls back per key', () => {
    const p = pages(FRENCH);
    expect(p.confirm.html).toContain('<html lang="fr" dir="ltr">');
    expect(p.confirm.title).toBe('Se déconnecter ?');
    expect(p.confirm.body).toContain('<button type="submit">Se déconnecter</button>');
    expect(p.done.body).toContain('<h1>Déconnecté</h1>');
    expect(p.refused.body).toContain('<h1>Déconnecté</h1>');
    expect(p.unauthenticated.body).toContain('<h1>Déconnexion impossible</h1>');
    // Not in the French fixture.
    expect(p.confirm.body).toContain(en['logout.confirm.body']);
    expect(p.noSession.title).toBe('Already signed out');
    expect(pages(ARABIC).done.html).toContain('<html lang="ar" dir="rtl">');
  });
});

describe('renderLoggedOutRedirectPage', () => {
  const target = 'https://app.example/after?state=a&b=2';
  const frames = ['https://rp-one.example/logout?iss=a', 'https://rp-two.example/logout?iss=a'];

  it('frames each URL and licenses exactly those origins', () => {
    const page = renderLoggedOutRedirectPage(frames, target, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('<iframe src="https://rp-one.example/logout?iss=a"></iframe>');
    expect(page.body).toContain('<iframe src="https://rp-two.example/logout?iss=a"></iframe>');
    expect(page.frames).toEqual(['https://rp-one.example', 'https://rp-two.example']);
    expectFragment(page);
  });

  it('carries a link to the target, escaped, for the script and for a reader', () => {
    const page = renderLoggedOutRedirectPage(frames, target, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain(
      '<a id="continue" href="https://app.example/after?state=a&amp;b=2">',
    );
  });

  it('falls back to a meta refresh that works without script', () => {
    const page = renderLoggedOutRedirectPage(frames, target, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain(
      '<meta http-equiv="refresh" content="5;url=https://app.example/after?state=a&amp;b=2">',
    );
  });

  it('declares the nonce its own script carries, and no request of its own', () => {
    const page = renderLoggedOutRedirectPage(frames, target, DEFAULT_PAGE_LOCALE);
    const nonce = page.script?.nonce;
    expect(nonce).toBeDefined();
    expect(page.body).toContain(`<script nonce="${nonce ?? ''}">`);
    expect(page.script?.fetchesSameOrigin).toBe(false);
  });

  it('never interpolates the target into the script', () => {
    const hostile = 'https://app.example/</script><script>alert(1)</script>';
    const page = renderLoggedOutRedirectPage(frames, hostile, DEFAULT_PAGE_LOCALE);
    const script = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(page.body)?.[1] ?? '';
    expect(script).not.toContain('app.example');
    expect(page.body).not.toContain('<script>alert(1)');
  });

  it('counts a frame once however often it fires load', () => {
    const page = renderLoggedOutRedirectPage(frames, target, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('frame.dataset.seen');
  });
});
