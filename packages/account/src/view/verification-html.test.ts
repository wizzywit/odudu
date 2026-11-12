import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import {
  renderEmailConfirmPage,
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
  sendVerificationHtml,
} from '#/view/verification-html';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'verification.succeeded.title': 'Adresse e-mail vérifiée',
    'verification.succeeded.heading': 'Votre adresse e-mail est vérifiée',
    'verification.failed.heading': "Ce lien n'est pas utilisable",
  });
});

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderVerificationSucceededPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderVerificationSucceededPage(null, null, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe('Email confirmed');
    expect(page.body).toContain('is confirmed');
    expectFragment(page);
  });

  it('keeps the English markup exactly', () => {
    expect(renderVerificationSucceededPage(null, null, DEFAULT_PAGE_LOCALE).body)
      .toBe(`<h1>Your email address is confirmed</h1>
<p>Return to the application you were signing in to and sign in again.</p>`);
  });

  it('with a way back it is the same heading and a link to continue, and no sentence about closing', () => {
    expect(
      renderVerificationSucceededPage(
        '/tenants/acme/protocol/openid-connect/auth?client_id=c',
        null,
        DEFAULT_PAGE_LOCALE,
      ).body,
    ).toBe(`<h1>Your email address is confirmed</h1>
<p class="links">
<a href="/tenants/acme/protocol/openid-connect/auth?client_id=c">Continue to sign in</a>
</p>`);
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const page = renderVerificationSucceededPage(null, null, FRENCH);
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.title).toBe('Adresse e-mail vérifiée');
    expect(page.body).toContain('<h1>Votre adresse e-mail est vérifiée</h1>');
    expect(page.body).toContain(`<p>${en['verification.succeeded.next']}</p>`);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(renderVerificationSucceededPage(null, null, ARABIC).html).toContain(
      '<html lang="ar" dir="rtl">',
    );
  });
});

describe('renderVerificationFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderVerificationFailedPage(null, null, DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe("Can't verify this link");
    expect(page.body).toContain('This link can&#39;t be used');
    expectFragment(page);
  });

  it('keeps the English markup exactly, apostrophe escaped as the catalogue escapes it', () => {
    expect(renderVerificationFailedPage(null, null, DEFAULT_PAGE_LOCALE).body)
      .toBe(`<h1>This link can&#39;t be used</h1>
<p>It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.</p>`);
  });

  it('reads French where the fixture has it and English for the rest', () => {
    const page = renderVerificationFailedPage(null, null, FRENCH);
    expect(page.title).toBe(en['verification.failed.title']);
    expect(page.body).toContain('<h1>Ce lien n&#39;est pas utilisable</h1>');
    expect(page.body).toContain(en['verification.failed.reason']);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(renderVerificationFailedPage(null, null, ARABIC).html).toContain(
      '<html lang="ar" dir="rtl">',
    );
  });
});

describe('sendVerificationHtml', () => {
  async function respond(locale: typeof DEFAULT_PAGE_LOCALE) {
    const app = Fastify();
    app.get('/', (_request, reply) =>
      sendVerificationHtml(reply, 400, renderVerificationFailedPage(null, null, locale)),
    );
    const response = await app.inject({ method: 'GET', url: '/' });
    await app.close();
    return response;
  }

  it('sends content-language from the verification wrapper', async () => {
    expect((await respond(FRENCH)).headers['content-language']).toBe('fr');
    expect((await respond(DEFAULT_PAGE_LOCALE)).headers['content-language']).toBe('en');
  });

  it('sends the status, the html type and the page', async () => {
    const response = await respond(DEFAULT_PAGE_LOCALE);
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('<html lang="en" dir="ltr">');
  });
});

describe('the pages a mailed link opens, with the way back it carried', () => {
  const way = '/tenants/acme/protocol/openid-connect/auth?client_id=c&state=x';
  const anchor =
    '<p class="links">\n<a href="/tenants/acme/protocol/openid-connect/auth?client_id=c&amp;state=x">Back to sign in</a>\n</p>';

  it('links back from the verified and the failed page, and from neither without it', () => {
    expect(renderVerificationSucceededPage(way, null, DEFAULT_PAGE_LOCALE).body).toContain(
      anchor.replace('Back to sign in', 'Continue to sign in'),
    );
    expect(renderVerificationFailedPage(way, null, DEFAULT_PAGE_LOCALE).body).toContain(anchor);
    expect(renderVerificationSucceededPage(null, null, DEFAULT_PAGE_LOCALE).body).not.toContain(
      'links',
    );
    expect(renderVerificationFailedPage(null, null, DEFAULT_PAGE_LOCALE).body).not.toContain(
      'links',
    );
  });
});

describe('renderEmailConfirmPage', () => {
  it('asks for one click, and carries the key only in the form', () => {
    const page = renderEmailConfirmPage(
      pathAddress('https://idp.example', 'acme'),
      'k"ey',
      null,
      DEFAULT_PAGE_LOCALE,
    );

    expectFragment(page);
    expect(page.body).toContain('<h1>Confirm your email address</h1>');
    expect(page.body).toContain('<button type="submit">Confirm my email</button>');
    expect(page.body).toContain(
      '<form method="post" action="/tenants/acme/login-actions/action-token">',
    );
    expect(page.body).toContain('<input type="hidden" name="key" value="k&quot;ey">');
    expect(page.body).not.toContain('Account name');
    expect(page.body.match(/<a /gu)).toBeNull();
    expect(page.script).toBeNull();
  });

  it('names the account a registration link will create, isolated', () => {
    const page = renderEmailConfirmPage(
      pathAddress('https://idp.example', 'acme'),
      'k',
      '<ada>',
      DEFAULT_PAGE_LOCALE,
    );

    expect(page.body).toContain('Account name: <bdi>&lt;ada&gt;</bdi>');
  });
});

describe('the way back to an application', () => {
  const back =
    '<a href="https://app.example/after?action_status=success">Return to the application</a>';

  it('is one more link on the page, and the page is otherwise as it was', () => {
    const plain = renderVerificationSucceededPage(null, null, DEFAULT_PAGE_LOCALE).body;
    const returning = renderVerificationSucceededPage(
      null,
      'https://app.example/after?action_status=success',
      DEFAULT_PAGE_LOCALE,
    ).body;
    expect(plain).not.toContain('<a ');
    expect(returning).toContain(back);
    expect(returning.replace(/\n<p class="links">[\s\S]*<\/p>/u, '')).toBe(plain);
  });

  it('sits beside the way back to sign in on a refused link', () => {
    const refused = renderVerificationFailedPage(
      '/tenants/acme/protocol/openid-connect/auth?client_id=c',
      'https://app.example/after?action_status=error',
      DEFAULT_PAGE_LOCALE,
    ).body;
    expect(refused).toContain('Back to sign in</a>');
    expect(refused).toContain('action_status=error">Return to the application</a>');
  });
});
