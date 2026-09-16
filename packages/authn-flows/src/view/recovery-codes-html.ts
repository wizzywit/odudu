import { type RenderedPage } from '@odudu/kernel';

// What the page has to show: the codes in plaintext, and whether they
// displace a set the subject was issued earlier — a page that silently
// retired ten codes somebody still has on paper would be lying by omission.
export interface RecoveryCodesOffer {
  codes: readonly string[];
  replaced: boolean;
}

// Minimal, dependency-free HTML, the same choice #/view/totp-enrolment-html.ts
// makes: every interpolated value passes through escapeHtml so neither the
// realm name nor a code opens a reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The one render of these codes there will ever be. They are hashed in the
// database exactly as a password is, so no later page — and no
// administrator — can show them again; the form below carries no code back,
// only the acknowledgement that the page was seen.
export function renderRecoveryCodesPage(
  realm: string,
  authSessionId: string,
  offer: RecoveryCodesOffer,
  error?: string,
): RenderedPage {
  const target = `/realms/${escapeHtml(realm)}/login-actions/required-action?action=generate-recovery-codes`;
  const message = error === undefined ? '' : `<p><strong>${escapeHtml(error)}</strong></p>\n`;
  const replaced = offer.replaced
    ? '<p>These replace the codes issued to this account before now, which no longer work.</p>\n'
    : '';
  const items = offer.codes.map((code) => `  <li><code>${escapeHtml(code)}</code></li>`).join('\n');
  // No script: nothing on this page talks to an authenticator or fetches
  // anything, so the base content-security policy describes it exactly.
  return {
    script: null,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Save your recovery codes</title></head>
<body>
<h1>Save your recovery codes</h1>
${message}<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
${replaced}<ol>
${items}
</ol>
<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <button type="submit">I have saved these codes</button>
</form>
</body>
</html>`,
  };
}
