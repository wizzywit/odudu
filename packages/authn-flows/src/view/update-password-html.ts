import { type RenderedPage } from '@odudu/kernel';

// Minimal, dependency-free HTML, the same choice #/view/recovery-codes-html.ts
// makes: every interpolated value passes through escapeHtml so neither the
// realm name nor a policy message opens a reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The page a login parks on while `update-password` is owed, and the page a
// refused candidate comes back to. `violations` is every rule the realm's
// policy reported, listed at once for the reason evaluatePassword collects
// them all rather than stopping at the first. The hidden auth_session_id is
// this page's own CSRF defence and what resumes the parked login, exactly
// as on the enrolment pages beside it.
export function renderUpdatePasswordPage(
  realm: string,
  authSessionId: string,
  violations: readonly string[] = [],
): RenderedPage {
  const target = `/realms/${escapeHtml(realm)}/login-actions/required-action?action=update-password`;
  const listed =
    violations.length === 0
      ? ''
      : `<ul>\n${violations.map((message) => `<li>${escapeHtml(message)}</li>`).join('\n')}\n</ul>\n`;
  const title = 'Change your password';
  const body = `<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
${listed}<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Update password</button>
</form>`;
  // No script: nothing on this page fetches anything, so the base
  // content-security policy describes it exactly.
  return {
    script: null,
    title,
    body,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
${body}
</body>
</html>`,
  };
}
