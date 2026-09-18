import { type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';

function hiddenField(name: string, value: string | null): string {
  return value === null
    ? ''
    : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">\n  `;
}

export interface LogoutConfirmationFields {
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

// RP-Initiated Logout 1.0 §2's confirmation page. Unlike the login form's
// auth_session_id, `sessionId` here *is* the session cookie's own value,
// echoed back rather than a distinct one-time token — the POST is checked
// by comparing this field against what the cookie itself still resolves
// to, a double-submit-cookie defence rather than a single-use one. Ending
// a session on a bare GET would let an `<img>` tag on any page log the
// End-User out of every realm they hold one in — this form is what keeps
// that a POST, from this browser, with this browser's own cookie.
export function renderLogoutConfirmationPage(
  realm: string,
  sessionId: string,
  fields: LogoutConfirmationFields,
): RenderedPage {
  const action = `/realms/${escapeHtml(realm)}/protocol/openid-connect/logout`;
  return page(
    'Sign out?',
    `<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="${action}">
  <input type="hidden" name="session_id" value="${escapeHtml(sessionId)}">
  ${hiddenField('client_id', fields.clientId)}${hiddenField('post_logout_redirect_uri', fields.postLogoutRedirectUri)}${hiddenField('state', fields.state)}<button type="submit">Sign out</button>
</form>`,
  );
}

// Reached when there is no live session to end at all — a missing or
// expired cookie, or one scoped to a different realm. Nothing to confirm,
// so no form: confirming would end nothing anyway.
export function renderNoActiveSessionPage(): RenderedPage {
  return page(
    'Already signed out',
    `<h1>Already signed out</h1>
<p>There is no active session to end.</p>`,
  );
}

// The session ended, and there was nowhere the request asked to send the
// End-User back to (no post_logout_redirect_uri at all).
export function renderLoggedOutPage(): RenderedPage {
  return page(
    'Signed out',
    `<h1>Signed out</h1>
<p>You have been signed out.</p>`,
  );
}

// The session still ended — RP-Initiated Logout 1.0's redirect rule (§3) is
// about the redirect alone, and refusing it must not look like refusing the
// logout itself, or an attacker's unmatched redirect_uri would be a way to
// keep a session alive.
export function renderLogoutRedirectRefusedPage(): RenderedPage {
  return page(
    'Signed out',
    `<h1>Signed out</h1>
<p>You have been signed out, but the address given to return to afterward is
not one this client has registered, so it has not been used.</p>`,
  );
}

// The confirmation form's CSRF defence failed — the hidden session id does
// not name the session the cookie itself resolves to. Nothing was ended;
// see #/usecase/logout.ts's `unauthenticated` outcome.
export function renderLogoutUnauthenticatedPage(): RenderedPage {
  return page(
    "Can't sign out",
    `<h1>Can't sign out</h1>
<p>This sign-out attempt is no longer valid. Go back and try again.</p>`,
  );
}
