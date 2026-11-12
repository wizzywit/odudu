import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { cancelButton, type ActionPageVariant } from '#/view/action-cancel';
import { escapeHtml, intro, page } from '#/view/document';
import { problemSummary } from '#/view/form-error';
import { bdi, t, tHtml, type MessageId } from '#/view/messages';
import { fillPage } from '#/view/template';

// What the page shows: the address held and whether it is proved.
export interface VerifyEmailOffer {
  email: string | null;
  verified: boolean;
}

// What the person has just done or been told: a link was queued, was held back
// by the limit on mail to one address, could not be sent at all, or the address
// is still not verified.
export type VerifyEmailNotice = 'sent' | 'limited' | 'unavailable' | 'not_verified';

const NOTICE_MESSAGE: Readonly<Record<Exclude<VerifyEmailNotice, 'not_verified'>, MessageId>> = {
  sent: 'verifyEmail.sent',
  limited: 'verifyEmail.limited',
  unavailable: 'verifyEmail.unavailable',
};

function verifyEmailPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: VerifyEmailOffer,
  notice: VerifyEmailNotice | undefined,
  locale: PageLocale,
  variant: ActionPageVariant | undefined,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=verify-email'),
  );
  const problems =
    notice === 'not_verified'
      ? [{ fields: [], html: tHtml(locale, 'verifyEmail.notVerified') }]
      : [];
  const status = offer.verified
    ? tHtml(locale, 'verifyEmail.alreadyVerified')
    : notice === undefined || notice === 'not_verified'
      ? ''
      : tHtml(locale, NOTICE_MESSAGE[notice]);
  const held = offer.email === null ? '' : bdi(offer.email);
  const send = offer.verified
    ? ''
    : `<button type="submit" name="send" value="1" formnovalidate>${tHtml(locale, 'verifyEmail.sendLink')}</button> `;
  const body = fillPage(
    'verify-email',
    {
      intro: intro(tHtml(locale, 'verifyEmail.title'), tenant),
      error: problemSummary(problems),
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
      fields: `<p>${tHtml(locale, 'verifyEmail.address')} ${held}</p>${status === '' ? '' : `\n  <p role="status">${status}</p>`}`,
      submit: `${send}<button type="submit">${tHtml(locale, 'verifyEmail.confirm')}</button>${cancelButton(variant, locale)}`,
      'form.close': '</form>',
    },
    locale,
    variant === 'requested'
      ? { from: 'verifyEmail.intro', to: 'verifyEmail.requestedIntro' }
      : undefined,
  );
  return page(t(locale, 'verifyEmail.title'), body, null, [], locale, 'verify-email');
}

// The page a login parks on while `verify-email` is owed.
export function renderVerifyEmailPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: VerifyEmailOffer,
  notice: VerifyEmailNotice | undefined,
  locale: PageLocale,
): RenderedPage {
  return verifyEmailPage(tenant, address, authSessionId, offer, notice, locale, undefined);
}

// The same page for a person an application sent here, who may leave it again.
export function renderRequestedVerifyEmailPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: VerifyEmailOffer,
  notice: VerifyEmailNotice | undefined,
  locale: PageLocale,
): RenderedPage {
  return verifyEmailPage(tenant, address, authSessionId, offer, notice, locale, 'requested');
}
