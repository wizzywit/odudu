import { sendVerificationHtml } from '#/view/verification-html';

export { sendVerificationHtml as sendResetHtml };

// Minimal, dependency-free HTML, the same choice
// packages/account/src/view/registration-html.ts makes: every interpolated
// value passes through escapeHtml so neither the realm name nor the token
// key opens a reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderResetRequestForm(realm: string): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/reset-password`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Forgot your password?</title></head>
<body>
<form method="post" action="${action}">
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <button type="submit">Send reset link</button>
</form>
</body>
</html>`;
}

// The whole point: this text is identical whether or not the address
// exists, and the route must reach it either way — see
// #/usecase/reset-password.ts's requestPasswordReset.
export function renderResetRequestedPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Check your email</title></head>
<body>
<h1>Check your email</h1>
<p>If that address has an account, we've sent a link to reset its password.</p>
</body>
</html>`;
}

export function renderResetRequestFailedPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can't send a reset link</title></head>
<body>
<h1>Can't send a reset link</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
}

export function renderResetPasswordForm(realm: string, key: string): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/action-token`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Choose a new password</title></head>
<body>
<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Reset password</button>
</form>
</body>
</html>`;
}

export function renderResetPasswordSucceededPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Password reset</title></head>
<body>
<h1>Your password has been reset</h1>
<p>You can close this page and sign in with your new password.</p>
</body>
</html>`;
}

export function renderResetLinkFailedPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can't use this link</title></head>
<body>
<h1>This link can't be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>
</body>
</html>`;
}

// Distinct from renderResetLinkFailedPage: reached only when the key is
// present and unexamined, so the link itself may be perfectly good — the
// submission was just missing the one field that matters.
export function renderResetPasswordRequiredPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can't reset your password</title></head>
<body>
<h1>Can't reset your password</h1>
<p>A new password is required.</p>
</body>
</html>`;
}
