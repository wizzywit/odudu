import { scriptNonce, type RenderedPage } from '@odudu/kernel';
import { type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';

// Matches LABEL_MAX_LENGTH in #/usecase/passkey-enrolment.ts, which
// truncates anything longer: the attribute is a courtesy to whoever is
// typing, not the bound itself, since nothing stops a submission that
// never rendered this page.
const LABEL_MAX_LENGTH = 64;

// What an enrolment page has to hand the browser: the creation options the
// server issued, which name the relying party and carry the challenge.
export interface PasskeyEnrolmentOffer {
  options: PublicKeyCredentialCreationOptionsJSON;
}

// Minimal, dependency-free HTML, the same choice
// #/view/totp-enrolment-html.ts makes: every interpolated value passes
// through escapeHtml so neither the realm name nor the auth session id
// opens a reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  realm: string,
  authSessionId: string,
  offer: PasskeyEnrolmentOffer,
  error?: string,
): RenderedPage {
  // Minted here and handed back with the markup that carries it, so the
  // policy served with this page cannot name a different value — a refused
  // script is invisible in a response, so nothing else would notice.
  const nonce = scriptNonce();
  const target = `/realms/${escapeHtml(realm)}/login-actions/required-action?action=configure-passkey`;
  const message = error === undefined ? '' : `<p><strong>${escapeHtml(error)}</strong></p>\n`;
  // The options are inline, so this script fetches nothing.
  return {
    script: { nonce, fetchesSameOrigin: false },
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Add a passkey</title></head>
<body>
<h1>Add a passkey</h1>
${message}<p>Your device will ask you to confirm. Nothing is stored until it does.</p>
<form method="post" action="${target}" id="passkey-form">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="credential" id="passkey-credential">
  <label>Name this passkey <input type="text" name="label" placeholder="Passkey" maxlength="${String(LABEL_MAX_LENGTH)}"></label>
  <button type="submit" id="passkey-submit">Add passkey</button>
</form>
<p id="passkey-error" hidden></p>
<noscript><p>Adding a passkey needs JavaScript, because only the browser can talk to your authenticator.</p></noscript>
<script nonce="${escapeHtml(nonce)}">
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
    failure.textContent =
      'Your device did not finish adding the passkey — ' + (caught && caught.message ? caught.message : 'the request was cancelled') + '. You can try again.';
    failure.hidden = false;
  }
});
</script>
</body>
</html>`,
  };
}
