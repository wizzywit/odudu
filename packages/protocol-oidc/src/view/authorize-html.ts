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

// The hidden field is the whole of this page's CSRF defence: authSessionId
// is an unguessable id (newId()) that only a browser which actually loaded
// this response — rendered same-origin, never carried in a URL an attacker
// could read or replay — can submit back. POST /realms/{realm}/login-actions/authenticate
// treats a submission whose auth_session_id does not name a live authentication
// session as unauthenticated, exactly as it would treat a missing token.
export function renderLoginForm(realm: string, authSessionId: string): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/authenticate`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`;
}
