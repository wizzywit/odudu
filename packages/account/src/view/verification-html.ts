import {
  addressPath,
  type PageLocale,
  pageHeaders,
  type RenderedPage,
  type TenantAddress,
} from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { escapeHtml, page } from '#/view/document';
import { applicationWay, links } from '#/view/links';
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
function backToSignIn(
  signInPath: string | null,
  application: string | null,
  locale: PageLocale,
): string {
  return links([
    signInPath === null ? null : { href: signInPath, text: tHtml(locale, 'link.backToSignIn') },
    applicationWay(application, tHtml(locale, 'link.returnToApplication')),
  ]);
}

// Verifying needs no session: the token is single-use and works in any browser.
// With the sign-in the link was mailed for, the page leads straight back to it;
// without one it says what to do, and implies no sign-in is waiting.
export function renderVerificationSucceededPage(
  signInPath: string | null,
  application: string | null,
  locale: PageLocale,
): RenderedPage {
  const heading = `<h1>${tHtml(locale, 'verification.succeeded.heading')}</h1>`;
  return page(
    t(locale, 'verification.succeeded.title'),
    fillNotice(
      `${heading}${
        signInPath === null ? `\n<p>${tHtml(locale, 'verification.succeeded.next')}</p>` : ''
      }${links([
        signInPath === null
          ? null
          : { href: signInPath, text: tHtml(locale, 'link.continueToSignIn') },
        applicationWay(application, tHtml(locale, 'link.returnToApplication')),
      ])}`,
      '',
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

// A link that cannot be used. Given a key it also offers a form that asks for
// a new one: shown for every key alike, so the page says nothing of whether
// the key was ever issued.
export function renderVerificationFailedPage(
  signInPath: string | null,
  application: string | null,
  resend: { address: TenantAddress; key: string } | null,
  locale: PageLocale,
): RenderedPage {
  const message = `<h1>${tHtml(locale, 'verification.failed.heading')}</h1>
<p>${tHtml(locale, 'verification.failed.reason')}</p>`;
  const way = backToSignIn(signInPath, application, locale);
  if (resend === null)
    return page(
      t(locale, 'verification.failed.title'),
      fillNotice(message, way, locale),
      null,
      [],
      locale,
      'notice',
    );
  const action = escapeHtml(addressPath(resend.address, '/login-actions/resend-verification'));
  return page(
    t(locale, 'verification.failed.title'),
    fillPage(
      'verification',
      {
        message,
        'form.open': `\n<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(resend.key)}">`,
        submit: `\n  <button type="submit">${tHtml(locale, 'verification.resend.button')}</button>\n`,
        'form.close': '</form>',
        links: way,
      },
      locale,
    ),
    null,
    [],
    locale,
    'verification',
  );
}

// What a request for a new link answers, whatever became of it.
export function renderVerificationResentPage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'verification.resent.title'),
    fillNotice(
      `<h1>${tHtml(locale, 'verification.resent.heading')}</h1>
<p>${tHtml(locale, 'verification.resent.next')}</p>`,
      '',
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
export interface ConfirmedParty {
  readonly tenant: string;
  // The address the link proves, when the link names one.
  readonly email: string | null;
  // The account a registration link will create.
  readonly username: string | null;
}

export function renderEmailConfirmPage(
  address: TenantAddress,
  key: string,
  who: ConfirmedParty,
  locale: PageLocale,
): RenderedPage {
  const action = escapeHtml(addressPath(address, '/login-actions/action-token'));
  const lines = [
    who.email === null ? null : tHtml(locale, 'confirm.address', {}, { email: who.email }),
    who.username === null ? null : tHtml(locale, 'confirm.account', {}, { username: who.username }),
    tHtml(locale, 'confirm.tenant', {}, { tenant: who.tenant }),
  ].filter((line): line is string => line !== null);
  const facts = lines.map((line) => `\n<p>${line}</p>`).join('');
  return page(
    t(locale, 'confirm.title'),
    fillPage(
      'verification',
      {
        message: `<h1>${tHtml(locale, 'confirm.title')}</h1>${facts}
<p>${tHtml(locale, 'confirm.next')}</p>`,
        'form.open': `\n<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">`,
        submit: `\n  <button type="submit">${tHtml(locale, 'confirm.button')}</button>\n`,
        'form.close': '</form>',
        links: '',
      },
      locale,
    ),
    null,
    [],
    locale,
    'verification',
  );
}
