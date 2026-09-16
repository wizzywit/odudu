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
  // No username: which account the code is checked against comes from the
  // authentication session the hidden field names, never from this form.
  if (form === 'otp') {
    return `<label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>`;
  }
  // Unreachable today: the two authenticators with fields to render are
  // the two above, and a passkey has none — it is offered by
  // renderPasskeyOption below rather than as a set of inputs.
  return `<p>Unsupported sign-in step: ${escapeHtml(form)}</p>`;
}

// navigator.credentials.get() is the only way to produce an assertion, so
// the passkey half of this page cannot be a plain form: the script asks the
// server for options, asks the authenticator, then posts what it returns.
// No username anywhere in it — the options name no credentials, so the
// browser offers every discoverable one it holds and the account is
// whichever one answers. The challenge is issued per click rather than with
// the page, so a form left open overnight still gets a live one.
function renderPasskeyOption(realm: string, authSessionId: string, nonce: string): string {
  const escaped = escapeHtml(realm);
  return `
<form method="post" action="/realms/${escaped}/login-actions/authenticate" id="passkey-form">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <button type="submit" id="passkey-submit">Sign in with a passkey</button>
</form>
<p id="passkey-error" hidden></p>
<script nonce="${escapeHtml(nonce)}">
const form = document.getElementById('passkey-form');
const field = document.getElementById('passkey-assertion');
const failure = document.getElementById('passkey-error');
const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
form.addEventListener('submit', async (event) => {
  if (field.value !== '') return;
  event.preventDefault();
  failure.hidden = true;
  try {
    const offered = await fetch('/realms/${escaped}/login-actions/passkey-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_session_id: form.auth_session_id.value }),
    });
    if (!offered.ok) throw new Error('this server is not offering passkeys');
    const options = await offered.json();
    const assertion = await navigator.credentials.get({
      publicKey: { ...options, challenge: fromBase64Url(options.challenge) },
    });
    field.value = JSON.stringify(assertion.toJSON());
    form.submit();
  } catch (caught) {
    failure.textContent =
      'Your device did not finish signing in — ' + (caught && caught.message ? caught.message : 'the request was cancelled') + '. You can try again.';
    failure.hidden = false;
  }
});
</script>`;
}

// The hidden field is the whole of this page's CSRF defence: authSessionId
// is an unguessable id (newId()) that only a browser which actually loaded
// this response — rendered same-origin, never carried in a URL an attacker
// could read or replay — can submit back. POST /realms/{realm}/login-actions/authenticate
// treats a submission whose auth_session_id does not name a live authentication
// session as unauthenticated, exactly as it would treat a missing token. It is
// on every form this function renders, not just the password one, since it is
// what CSRF-protects the whole endpoint rather than any one authenticator.
export function renderLoginForm(
  realm: string,
  authSessionId: string,
  form: string,
  // Non-null offers a passkey, with the nonce its script needs (see
  // sendHtml): the relying party id comes from ODUDU_PUBLIC_BASE_URL and
  // nowhere else, so without that there is nothing behind the button.
  passkeyNonce: string | null = null,
): string {
  const action = `/realms/${escapeHtml(realm)}/login-actions/authenticate`;
  // Beside the password and nowhere else: a passkey is an alternative to
  // the first factor, not to a code asked for after one.
  const passkey =
    passkeyNonce !== null && form === 'password'
      ? renderPasskeyOption(realm, authSessionId, passkeyNonce)
      : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  ${renderFormFields(form)}
  <button type="submit">Sign in</button>
</form>${passkey}
</body>
</html>`;
}
