import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { problemSummary } from '#/view/form-error';
import { t, tHtml } from '#/view/messages';
import { fillPage } from '#/view/template';

// The terms in force: where to read them and which version is accepted.
export interface AcceptTermsOffer {
  uri: string;
  version: string;
}

// The page a login parks on while `accept-terms` is owed. Only the tenant asks
// for this, so the person has no way out of it, and `refused` is the box left
// unticked.
export function renderAcceptTermsPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: AcceptTermsOffer,
  refused: boolean,
  locale: PageLocale,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=accept-terms'),
  );
  const problems = refused
    ? [{ fields: ['accept'], html: tHtml(locale, 'acceptTerms.required') }]
    : [];
  const body = fillPage(
    'accept-terms',
    {
      intro: intro(tHtml(locale, 'acceptTerms.title'), tenant),
      error: problemSummary(problems),
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
      fields: `<p><a href="${escapeHtml(offer.uri)}" rel="noopener noreferrer" target="_blank">${tHtml(locale, 'acceptTerms.link')}</a> (${tHtml(locale, 'acceptTerms.version', {}, { version: offer.version })})</p>
  <label><input type="checkbox" name="accept" value="true"${refused ? ' aria-invalid="true" aria-describedby="form-error-0" autofocus' : ''}> ${tHtml(locale, 'acceptTerms.accept')}</label>`,
      submit: `<button type="submit">${tHtml(locale, 'acceptTerms.submit')}</button>`,
      'form.close': '</form>',
    },
    locale,
  );
  return page(t(locale, 'acceptTerms.title'), body, null, [], locale, 'accept-terms');
}
