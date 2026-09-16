import qrcode from 'qrcode-generator';

// What an enrolment page has to show: the secret in the form the user's
// authenticator app scans, and the same secret as text for an app that
// cannot use a camera.
export interface TotpEnrolmentOffer {
  secret: string;
  uri: string;
}

// Minimal, dependency-free HTML apart from the QR encoder, the same choice
// packages/protocol-oidc/src/view/authorize-html.ts and
// #/view/required-action-html.ts make: every interpolated value passes
// through escapeHtml so neither the realm name nor the secret opens a
// reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  realm: string,
  authSessionId: string,
  offer: TotpEnrolmentOffer,
  error?: string,
): string {
  const target = `/realms/${escapeHtml(realm)}/login-actions/required-action?action=configure-totp`;
  const message = error === undefined ? '' : `<p><strong>${escapeHtml(error)}</strong></p>\n`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Set up your authenticator</title></head>
<body>
<h1>Set up your authenticator</h1>
${message}<p>Scan this with your authenticator app, or enter the key by hand.</p>
${qrSvg(offer.uri)}
<p><code>${escapeHtml(offer.uri)}</code></p>
<p>Key: <code>${escapeHtml(offer.secret)}</code></p>
<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="secret" value="${escapeHtml(offer.secret)}">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <button type="submit">Confirm</button>
</form>
</body>
</html>`;
}
