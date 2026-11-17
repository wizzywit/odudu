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
// for this, so the person has no way out of it. `unticked` is the box left
// unticked; `stale` is terms that changed while the page was open, which this
// page shows again at the version now in force.
export function renderAcceptTermsPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: AcceptTermsOffer,
  notice: 'unticked' | 'stale' | undefined,
  locale: PageLocale,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=accept-terms'),
  );
  const problems =
    notice === undefined
      ? []
      : [
          {
            fields: ['accept'],
            html: tHtml(locale, notice === 'stale' ? 'acceptTerms.stale' : 'acceptTerms.required'),
          },
        ];
  const body = fillPage(
    'accept-terms',
    {
      intro: intro(tHtml(locale, 'acceptTerms.title'), tenant),
      error: problemSummary(problems),
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="version" value="${escapeHtml(offer.version)}">`,
      fields: `<p><a href="${escapeHtml(offer.uri)}" rel="noopener noreferrer" target="_blank">${tHtml(locale, 'acceptTerms.link')}</a> (${tHtml(locale, 'acceptTerms.version', {}, { version: offer.version })})</p>
  <label><input type="checkbox" name="accept" value="true"${notice === undefined ? '' : ' aria-invalid="true" aria-describedby="form-error-0" autofocus'}> ${tHtml(locale, 'acceptTerms.accept')}</label>`,
      submit: `<button type="submit">${tHtml(locale, 'acceptTerms.submit')}</button>`,
      'form.close': '</form>',
    },
    locale,
  );
  return page(t(locale, 'acceptTerms.title'), body, null, [], locale, 'accept-terms');
}
