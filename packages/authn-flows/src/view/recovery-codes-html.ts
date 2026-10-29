import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { type EnrolmentRefusal } from '#/schema/enrolment-refusal';
import { escapeHtml, intro, page } from '#/view/document';
import { t, tHtml, token } from '#/view/messages';
import { problemSummary } from '#/view/form-error';
import { refusalProblems } from '#/view/refusal';
import { fillPage } from '#/view/template';

// What the page has to show: the codes in plaintext, and whether they
// displace a set the subject was issued earlier — a page that silently
// retired ten codes somebody still has on paper would be lying by omission.
export interface RecoveryCodesOffer {
  codes: readonly string[];
  replaced: boolean;
}

// The one render of these codes there will ever be. They are hashed in the
// database exactly as a password is, so no later page — and no
// administrator — can show them again; the form below carries no code back,
// only the acknowledgement that the page was seen.
export function renderRecoveryCodesPage(
  tenant: string,
  authSessionId: string,
  offer: RecoveryCodesOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
): RenderedPage {
  const target = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/required-action?action=generate-recovery-codes`;
  const replaced = offer.replaced ? `<p>${tHtml(locale, 'recoveryCodes.replaced')}</p>\n` : '';
  const items = offer.codes.map((code) => `  <li>${token(code)}</li>`).join('\n');
  const title = t(locale, 'recoveryCodes.title');
  const body = fillPage(
    'recovery-codes',
    {
      intro: intro(tHtml(locale, 'recoveryCodes.title'), tenant),
      error: problemSummary(refusalProblems(locale, error, null)),
      instructions: `<p>${tHtml(locale, 'recoveryCodes.use')} <strong>${tHtml(locale, 'recoveryCodes.onlyTime')}</strong> ${tHtml(locale, 'recoveryCodes.keep')}</p>`,
      notice: replaced,
      codes: `<ol>
${items}
</ol>`,
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
      submit: `<button type="submit">${tHtml(locale, 'recoveryCodes.acknowledge')}</button>`,
      'form.close': '</form>',
    },
    locale,
  );
  // No script: nothing on this page talks to an authenticator or fetches
  // anything, so the base content-security policy describes it exactly.
  return page(title, body, null, [], locale, 'recovery-codes');
}
