import { type RequiredAction } from '#/schema/required-action';

// Minimal, dependency-free HTML, the same choice
// packages/protocol-oidc/src/view/authorize-html.ts and
// packages/account/src/view make: every interpolated value passes through
// escapeHtml so neither the realm name nor the auth session id opens a
// reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// `configure-totp`, `configure-passkey` and `generate-recovery-codes` each
// have a page of their own (#/view/totp-enrolment-html.ts and its two
// neighbours), reached before this one; what is left here is
// `update-password`, and the fallback for a deployment that cannot offer an
// action at all — no relying party id, and so no passkey to enrol.
function renderActionFields(action: RequiredAction): string {
  if (action === 'update-password') {
    return `<label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Update password</button>`;
  }
  return `<p>This account has a pending action (${escapeHtml(action)}) that cannot be completed here yet.</p>`;
}

// The hidden field carries auth_session_id forward exactly as
// renderLoginForm's does: the same unguessable id, rendered same-origin,
// is this page's own CSRF defence, and the still-unconsumed authentication
// session is what lets the eventual submission resume the parked login
// once the action is done.
export function renderRequiredActionPage(
  realm: string,
  authSessionId: string,
  action: RequiredAction,
): string {
  const target = `/realms/${escapeHtml(realm)}/login-actions/required-action?action=${encodeURIComponent(action)}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>One more step</title></head>
<body>
<h1>One more step</h1>
<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  ${renderActionFields(action)}
</form>
</body>
</html>`;
}
