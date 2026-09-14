// Minimal, dependency-free HTML, the same choice
// packages/account/src/view/verification-html.ts and
// packages/protocol-oidc/src/view/authorize-html.ts make: every interpolated
// value passes through escapeHtml so neither the realm name nor an error
// string opens a reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderRegistrationForm(realm: string): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/registration`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Create account</title></head>
<body>
<form method="post" action="${action}">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Create account</button>
</form>
</body>
</html>`;
}

export function renderRegistrationFailedPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can't create this account</title></head>
<body>
<h1>Can't create this account</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
}

// The word "verify" only appears here when the realm actually requires it —
// the whole point is that an unverified account cannot sign in yet, so the
// page must not claim otherwise.
export function renderRegistrationSucceededPage(verifyEmailRequired: boolean): string {
  const next = verifyEmailRequired
    ? '<p>Check your email for a link to verify your address before you can sign in.</p>'
    : '<p>You can now sign in.</p>';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Account created</title></head>
<body>
<h1>Account created</h1>
${next}
</body>
</html>`;
}
