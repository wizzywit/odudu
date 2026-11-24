import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { bdi, t, tHtml } from '#/view/messages';

export interface ApprovalPageView {
  readonly address: TenantAddress;
  readonly approvalId: string;
  // Bound to the person's session and to this approval; see `approvalProof`.
  readonly csrf: string;
  readonly tenant: string;
  // The client that is asking, as its registrant named it.
  readonly agent: string;
  // What the request asks for, as it was stored when the request was made.
  readonly summary: string;
  // The text the client sent for the person to read, null where it sent none.
  readonly bindingMessage: string | null;
  readonly expiresAt: Date;
}

// UTC to the minute, the same form the mail uses, so it reads the same in
// every language.
function minuteOf(at: Date): string {
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

// No script and no link: the page is a form of two buttons and what they
// decide. Everything a client or a tenant wrote reaches it through `bdi` or an
// isolated slot, so it is escaped once and cannot reorder the sentence around it.
export function renderApprovalPage(view: ApprovalPageView, locale: PageLocale): RenderedPage {
  const action = escapeHtml(addressPath(view.address, `/approval/${view.approvalId}`));
  return page(
    t(locale, 'approval.title'),
    `${intro(tHtml(locale, 'approval.heading', {}, { agent: view.agent }), view.tenant, [
      bdi(view.summary),
      ...(view.bindingMessage === null
        ? []
        : [tHtml(locale, 'approval.bindingMessage', {}, { message: view.bindingMessage })]),
    ])}
<p>${tHtml(locale, 'approval.expires', { when: minuteOf(view.expiresAt) })}</p>
<p>${tHtml(locale, 'approval.warning')}</p>
<form method="post" action="${action}">
  <input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
  <button type="submit" name="decision" value="approve">${tHtml(locale, 'approval.approve')}</button>
  <button type="submit" name="decision" value="deny" class="secondary">${tHtml(locale, 'approval.deny')}</button>
</form>`,
    null,
    [],
    locale,
  );
}

export function renderApprovalDecidedPage(
  decision: 'approved' | 'denied',
  locale: PageLocale,
): RenderedPage {
  const key = `approval.decided.${decision}` as const;
  return page(
    t(locale, `${key}.title`),
    `<h1>${tHtml(locale, `${key}.title`)}</h1>
<p>${tHtml(locale, `${key}.body`)}</p>`,
    null,
    [],
    locale,
  );
}

// The one answer for an approval that is unknown, someone else's, expired or
// already answered: it names no cause, because a cause would tell a reader
// whether somebody else's approval exists.
export function renderApprovalUnavailablePage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'approval.unavailable.title'),
    `<h1>${tHtml(locale, 'approval.unavailable.title')}</h1>
<p>${tHtml(locale, 'approval.unavailable.body')}</p>`,
    null,
    [],
    locale,
  );
}

export function renderApprovalRefusedPage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'approval.refused.title'),
    `<h1>${tHtml(locale, 'approval.refused.title')}</h1>
<p>${tHtml(locale, 'approval.refused.body')}</p>`,
    null,
    [],
    locale,
  );
}

// For a person whose browser holds no session and a deployment that has no
// sign-in to send them to.
export function renderApprovalSignInPage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'approval.signIn.title'),
    `<h1>${tHtml(locale, 'approval.signIn.title')}</h1>
<p>${tHtml(locale, 'approval.signIn.body')}</p>`,
    null,
    [],
    locale,
  );
}
