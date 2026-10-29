import { type PageLocale, pageHeaders, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { escapeHtml, page } from '#/view/document';
import { links } from '#/view/links';
import { t, tHtml } from '#/view/messages';
import { fillNotice, fillPage } from '#/view/template';

export function sendVerificationHtml(
  reply: FastifyReply,
  status: number,
  rendered: RenderedPage,
): FastifyReply {
  const withHeaders = pageHeaders(rendered).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html'),
  );
  return withHeaders.send(rendered.html);
}

// A way back to sign-in, when the mailed link carried one.
function backToSignIn(signInPath: string | null, locale: PageLocale): string {
  return signInPath === null
    ? ''
    : links([{ href: signInPath, text: tHtml(locale, 'link.backToSignIn') }]);
}

// Verifying needs no session: the token is single-use and works in any browser.
// With the sign-in the link was mailed for, the page leads straight back to it;
// without one it says what to do, and implies no sign-in is waiting.
export function renderVerificationSucceededPage(
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  const heading = `<h1>${tHtml(locale, 'verification.succeeded.heading')}</h1>`;
  return page(
    t(locale, 'verification.succeeded.title'),
    fillNotice(
      signInPath === null
        ? `${heading}\n<p>${tHtml(locale, 'verification.succeeded.next')}</p>`
        : `${heading}${links([{ href: signInPath, text: tHtml(locale, 'link.continueToSignIn') }])}`,
      '',
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

export function renderVerificationFailedPage(
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  return page(
    t(locale, 'verification.failed.title'),
    fillNotice(
      `<h1>${tHtml(locale, 'verification.failed.heading')}</h1>
<p>${tHtml(locale, 'verification.failed.reason')}</p>`,
      backToSignIn(signInPath, locale),
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

// What a mailed link shows on a visit, for an address to confirm and for a
// registration that waits on it. Opening the link changes nothing: a mail
// scanner or a link preview reads the page and the key is still good. One
// button posts the key back, and that confirms the address (and, for a
// registration, creates the account named on the page).
export function renderEmailConfirmPage(
  tenant: string,
  key: string,
  username: string | null,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/action-token`;
  const account =
    username === null ? '' : `\n<p>${tHtml(locale, 'confirm.account', {}, { username })}</p>`;
  return page(
    t(locale, 'confirm.title'),
    fillPage(
      'verification',
      {
        message: `<h1>${tHtml(locale, 'confirm.title')}</h1>${account}
<p>${tHtml(locale, 'confirm.next')}</p>`,
        'form.open': `\n<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">`,
        submit: `\n  <button type="submit">${tHtml(locale, 'confirm.button')}</button>\n`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'verification',
  );
}
