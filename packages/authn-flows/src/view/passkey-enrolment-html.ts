import { type PageLocale, scriptNonce, type RenderedPage } from '@odudu/kernel';
import { type EnrolmentRefusal } from '#/schema/enrolment-refusal';
import { escapeHtml, intro, page } from '#/view/document';
import { t, tHtml } from '#/view/messages';
import { problemSummary } from '#/view/form-error';
import { refusalProblems } from '#/view/refusal';
import { fillPage } from '#/view/template';
import { type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';

// Matches LABEL_MAX_LENGTH in #/usecase/passkey-enrolment.ts, which
// truncates anything longer: the attribute is a courtesy to whoever is
// typing, not the bound itself, since nothing stops a submission that
// never rendered this page.
const LABEL_MAX_LENGTH = 64;

// Stands in for the browser's own reason in the sentence the page hands its
// script; the script swaps it for the reason the browser reports.
const REASON = '{reason}';

// What an enrolment page has to hand the browser: the creation options the
// server issued, which name the relying party and carry the challenge.
export interface PasskeyEnrolmentOffer {
  options: PublicKeyCredentialCreationOptionsJSON;
}

// HTML escaping is wrong inside a <script>, where the parser reads text
// rather than markup: what has to be neutralised there is the sequence that
// ends the element, plus the two line terminators JSON allows raw and
// JavaScript does not.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

// navigator.credentials.create() is the only way to produce a registration
// response, so this page cannot be a plain form: the script asks the
// authenticator, then posts what it returns. The options come from the
// server and the challenge inside them is not in this page's form — it is
// on the authentication session, which is also what binds the submission to
// the subject that attempt has already identified.
export function renderPasskeyEnrolmentPage(
  tenant: string,
  authSessionId: string,
  offer: PasskeyEnrolmentOffer,
  error: EnrolmentRefusal | undefined,
  locale: PageLocale,
): RenderedPage {
  // Minted here and handed back with the markup that carries it, so the
  // policy served with this page cannot name a different value — a refused
  // script is invisible in a response, so nothing else would notice.
  const nonce = scriptNonce();
  const target = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/required-action?action=configure-passkey`;
  // The options are inline, so this script fetches nothing.
  const title = t(locale, 'passkey.title');
  const script = `<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>${tHtml(locale, 'passkey.needsScript')}</p></noscript>
<script nonce="${escapeHtml(nonce)}">
function start() {
const options = ${jsonForScript(offer.options)};
const form = document.getElementById('passkey-form');
const field = document.getElementById('passkey-credential');
const failure = document.getElementById('passkey-error');
const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
form.addEventListener('submit', async (event) => {
  if (field.value !== '') return;
  event.preventDefault();
  failure.hidden = true;
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: fromBase64Url(options.challenge),
        user: { ...options.user, id: fromBase64Url(options.user.id) },
        excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
          ...c,
          id: fromBase64Url(c.id),
        })),
      },
    });
    field.value = JSON.stringify(credential.toJSON());
    form.submit();
  } catch (caught) {
    // Cancelling the operating system's prompt rejects the promise, and so
    // does an authenticator that will not meet what the options require.
    // Without this the page simply stops, looking broken rather than
    // waiting for another go.
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
    failure.textContent = form.dataset.failed.replace('${REASON}', () => reason);
    failure.hidden = false;
  }
});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
</script>`;
  const body = fillPage(
    'passkey-enrolment',
    {
      intro: intro(tHtml(locale, 'passkey.title'), tenant),
      error: problemSummary(refusalProblems(locale, error, null)),
      'form.open': `<form method="post" action="${target}" id="passkey-form" data-failed="${tHtml(locale, 'passkey.failed', { reason: REASON })}" data-cancelled="${tHtml(locale, 'passkey.cancelled')}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="credential" id="passkey-credential">`,
      fields: `<label>${tHtml(locale, 'passkey.nameLabel')} <input type="text" name="label" placeholder="${tHtml(locale, 'passkey.namePlaceholder')}" maxlength="${String(LABEL_MAX_LENGTH)}"></label>`,
      submit: `<button type="submit" id="passkey-submit">${tHtml(locale, 'passkey.submit')}</button>`,
      script,
      'form.close': '</form>',
    },
    locale,
  );
  return page(title, body, { nonce, fetchesSameOrigin: false }, [], locale, 'passkey-enrolment');
}
