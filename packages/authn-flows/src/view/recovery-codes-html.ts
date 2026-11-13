import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { type EnrolmentRefusal } from '#/schema/enrolment-refusal';
import { cancelButton, type ActionPageVariant } from '#/view/action-cancel';
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
function recoveryCodesPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: RecoveryCodesOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
  variant: ActionPageVariant | undefined,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=generate-recovery-codes'),
  );
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
      submit: `<button type="submit">${tHtml(locale, 'recoveryCodes.acknowledge')}</button>${cancelButton(variant, locale)}`,
      'form.close': '</form>',
    },
    locale,
  );
  // No script: nothing on this page talks to an authenticator or fetches
  // anything, so the base content-security policy describes it exactly.
  return page(title, body, null, [], locale, 'recovery-codes');
}

export function renderRecoveryCodesPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: RecoveryCodesOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
): RenderedPage {
  return recoveryCodesPage(tenant, address, authSessionId, offer, error, locale, undefined);
}

// The same page for a person an application sent here, who may leave it again.
export function renderRequestedRecoveryCodesPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: RecoveryCodesOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
): RenderedPage {
  return recoveryCodesPage(tenant, address, authSessionId, offer, error, locale, 'requested');
}

// The question put to a person before anything is issued: a set is created
// or replaced by confirming, not by being shown this page.
export function renderRequestedRecoveryCodesConfirmPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  replaces: boolean,
  locale: PageLocale,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=generate-recovery-codes'),
  );
  const body = fillPage(
    'recovery-codes',
    {
      intro: intro(tHtml(locale, 'recoveryCodes.title'), tenant),
      error: '',
      instructions: `<p>${tHtml(locale, replaces ? 'recoveryCodes.confirmReplace' : 'recoveryCodes.confirmIssue')}</p>`,
      notice: '',
      codes: '',
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="confirm" value="1">`,
      submit: `<button type="submit">${tHtml(locale, replaces ? 'recoveryCodes.confirm' : 'recoveryCodes.confirmCreate')}</button>${cancelButton('requested', locale)}`,
      'form.close': '</form>',
    },
    locale,
  );
  return page(t(locale, 'recoveryCodes.title'), body, null, [], locale, 'recovery-codes');
}

// A replacement the hourly bound refuses: the codes the person holds still
// work. Only a page an application sent them to has a way out, as the others do.
export function renderRecoveryCodesTooSoonPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  retryInMinutes: number,
  variant: ActionPageVariant | undefined,
  locale: PageLocale,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=generate-recovery-codes'),
  );
  const body = fillPage(
    'recovery-codes',
    {
      intro: intro(tHtml(locale, 'recoveryCodes.title'), tenant),
      error: problemSummary([
        { fields: [], html: tHtml(locale, 'recoveryCodes.tooSoon', { minutes: retryInMinutes }) },
      ]),
      instructions: '',
      notice: '',
      codes: '',
      'form.open':
        variant === undefined
          ? ''
          : `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
      submit: cancelButton(variant, locale).trimStart(),
      'form.close': variant === undefined ? '' : '</form>',
    },
    locale,
  );
  return page(t(locale, 'recoveryCodes.title'), body, null, [], locale, 'recovery-codes');
}
