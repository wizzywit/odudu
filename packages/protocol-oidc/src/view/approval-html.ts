import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { bdi, t, tHtml } from '#/view/messages';
import { fillPage } from '#/view/template';

export interface ApprovalPageView {
  readonly address: TenantAddress;
  readonly approvalId: string;
  // Bound to the person's session and to this approval; see `APPROVAL_DECISION`.
  readonly csrf: string;
  readonly tenant: string;
  // The client that is asking, as its registrant named it.
  readonly agent: string;
  // What the request asks for, as it was stored when the request was made.
  readonly summary: string;
  // The scopes the request asked for, null where it is no longer known; the
  // page then shows the summary as it was stored.
  readonly scope: string | null;
  // The text the client sent for the person to read, null where it sent none.
  readonly bindingMessage: string | null;
  readonly expiresAt: Date;
}

// UTC to the minute, the same form the mail uses, so it reads the same in
// every language.
function minuteOf(at: Date): string {
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

// What the pages that only say something fill `logged-out` with: `message` is
// the whole of their text, and the rest is empty.
function textOnly(message: string): Record<string, string> {
  return { message, links: '', frames: '', script: '' };
}

type Saying =
  | 'approval.decided.approved'
  | 'approval.decided.denied'
  | 'approval.unavailable'
  | 'approval.refused'
  | 'approval.signIn';

function saying(which: Saying, locale: PageLocale): RenderedPage {
  return page(
    t(locale, `${which}.title`),
    fillPage(
      'logged-out',
      textOnly(
        `<h1>${tHtml(locale, `${which}.title`)}</h1>\n<p>${tHtml(locale, `${which}.body`)}</p>`,
      ),
      locale,
    ),
    null,
    [],
    locale,
    'logged-out',
  );
}

// No script and no link: the page is a form of two buttons and what they
// decide. What a client or a tenant wrote reaches it through `bdi` or an
// isolated slot, so it is escaped once and cannot reorder the sentence around it.
// The decision form and the text a person decides on are server-owned parts: a
// theme's template places them and cannot drop them.
export function renderApprovalPage(view: ApprovalPageView, locale: PageLocale): RenderedPage {
  const action = escapeHtml(addressPath(view.address, `/approval/${view.approvalId}`));
  const details = `${intro(
    tHtml(locale, 'approval.heading', {}, { agent: view.agent }),
    view.tenant,
    [
      view.scope === null
        ? bdi(view.summary)
        : tHtml(locale, 'approval.asks', {}, { agent: view.agent, scope: view.scope }),
      ...(view.bindingMessage === null
        ? []
        : [tHtml(locale, 'approval.bindingMessage', {}, { message: view.bindingMessage })]),
    ],
  )}
<p>${tHtml(locale, 'approval.expires', { when: minuteOf(view.expiresAt) })}</p>
<p>${tHtml(locale, 'approval.warning')}</p>`;
  return page(
    t(locale, 'approval.title'),
    fillPage(
      'approval',
      {
        details,
        'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">`,
        'submit.approve': `<button type="submit" name="decision" value="approve">${tHtml(locale, 'approval.approve')}</button>`,
        'submit.deny': `<button type="submit" name="decision" value="deny" class="secondary">${tHtml(locale, 'approval.deny')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'approval',
  );
}

export function renderApprovalDecidedPage(
  decision: 'approved' | 'denied',
  locale: PageLocale,
): RenderedPage {
  return saying(`approval.decided.${decision}`, locale);
}

// The one answer for an approval that is unknown, someone else's, expired or
// already answered: it names no cause, because a cause would tell a reader
// whether somebody else's approval exists.
export function renderApprovalUnavailablePage(locale: PageLocale): RenderedPage {
  return saying('approval.unavailable', locale);
}

export function renderApprovalRefusedPage(locale: PageLocale): RenderedPage {
  return saying('approval.refused', locale);
}

// For a person whose browser holds no session and a deployment that has no
// sign-in to send them to.
export function renderApprovalSignInPage(locale: PageLocale): RenderedPage {
  return saying('approval.signIn', locale);
}
