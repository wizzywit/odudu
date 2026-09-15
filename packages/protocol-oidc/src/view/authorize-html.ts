// Minimal, dependency-free HTML: the two pages /authorize can render are
// small enough that pulling in a templating engine would cost more than it
// saves, and every interpolated value passes through escapeHtml so neither
// page opens a reflected-XSS hole through the realm name or an error string.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuthorizeErrorPage(error: string, description: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in error</title></head>
<body>
<h1>Can't continue</h1>
<p>${escapeHtml(description)}</p>
<p><small>${escapeHtml(error)}</small></p>
</body>
</html>`;
}

// No auth_session_id here, unlike renderLoginForm below: this page has no
// form to resubmit, since the next step happens in the user's inbox, not on
// this page. `hasEmail` false means there is no address on file at all — a
// realm turning verify_email on locks these accounts out with nothing they
// can do about it, so the page says that rather than claiming a mail it
// never sent.
export function renderEmailUnverifiedPage(hasEmail: boolean): string {
  const detail = hasEmail
    ? 'We sent a link to the address on this account — follow it, then sign in again.'
    : 'This account has no email address on file, so there is nothing to verify yet. Contact an administrator.';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Verify your email</title></head>
<body>
<h1>Can't sign in yet</h1>
<p>You need to verify your email address before you can sign in. ${detail}</p>
</body>
</html>`;
}

// `form` names the authenticator to render fields for (an authn-flows
// registry key, e.g. 'password') — not a fixed enum, so a new authenticator
// adds a case here rather than a schema change.
function renderFormFields(form: string): string {
  if (form === 'password') {
    return `<label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>`;
  }
  // Unreachable today: initialChallenge/pendingChallenge (authn-flows) only
  // ever name an authenticator this server can actually dispatch to, and
  // 'password' is the only one with a runtime yet.
  return `<p>Unsupported sign-in step: ${escapeHtml(form)}</p>`;
}

// The hidden field is the whole of this page's CSRF defence: authSessionId
// is an unguessable id (newId()) that only a browser which actually loaded
// this response — rendered same-origin, never carried in a URL an attacker
// could read or replay — can submit back. POST /realms/{realm}/login-actions/authenticate
// treats a submission whose auth_session_id does not name a live authentication
// session as unauthenticated, exactly as it would treat a missing token. It is
// on every form this function renders, not just the password one, since it is
// what CSRF-protects the whole endpoint rather than any one authenticator.
export function renderLoginForm(realm: string, authSessionId: string, form: string): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/authenticate`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  ${renderFormFields(form)}
  <button type="submit">Sign in</button>
</form>
</body>
</html>`;
}
