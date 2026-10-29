import qrcode from 'qrcode-generator';
import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { type EnrolmentRefusal } from '#/schema/enrolment-refusal';
import { escapeHtml, intro, page } from '#/view/document';
import { t, tHtml, token } from '#/view/messages';
import { firstInvalidField, invalidAttributes, problemSummary } from '#/view/form-error';
import { refusalProblems } from '#/view/refusal';
import { fillPage } from '#/view/template';

// What an enrolment page has to show: the secret in the form the user's
// authenticator app scans, and the same secret as text for an app that
// cannot use a camera.
export interface TotpEnrolmentOffer {
  secret: string;
  uri: string;
}

// Error correction level M and an automatic version: an otpauth:// URI is
// well under the capacity of the smallest symbol that fits it, and letting
// the encoder pick keeps the image no larger than the data needs.
function qrSvg(uri: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// The secret travels back in a hidden field rather than being stored
// unverified: a credential written before its first correct code locks the
// account out of its own second factor if the app never scanned it. The
// submission is bound to this attempt by auth_session_id, exactly as the
// login form is, so what comes back can only enrol the subject that
// authentication session is already bound to.
export function renderTotpEnrolmentPage(
  tenant: string,
  authSessionId: string,
  offer: TotpEnrolmentOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
): RenderedPage {
  const target = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/required-action?action=configure-totp`;
  const problems = refusalProblems(locale, error, 'code');
  const code = `${invalidAttributes(problems, 'code')}${firstInvalidField(problems, ['code']) === null ? '' : ' autofocus'}`;
  return page(
    t(locale, 'totp.title'),
    fillPage(
      'totp-enrolment',
      {
        intro: intro(tHtml(locale, 'totp.title'), tenant),
        error: problemSummary(problems),
        offer: `<p>${tHtml(locale, 'totp.scan')}</p>
${qrSvg(offer.uri)}
<p>${token(offer.uri)}</p>
<p>${tHtml(locale, 'totp.key')} ${token(offer.secret)}</p>`,
        'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="secret" value="${escapeHtml(offer.secret)}">`,
        fields: `<label>${tHtml(locale, 'totp.codeLabel')} <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"${code}></label>`,
        submit: `<button type="submit">${tHtml(locale, 'totp.confirm')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'totp-enrolment',
  );
}
