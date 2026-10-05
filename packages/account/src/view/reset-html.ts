import { type RenderedPage } from '@odudu/kernel';
import { sendVerificationHtml } from '#/view/verification-html';
import { escapeHtml, page } from '#/view/document';

export { sendVerificationHtml as sendResetHtml };

export function renderResetRequestForm(tenant: string): RenderedPage {
  const action = `/tenants/${escapeHtml(tenant)}/login-actions/reset-password`;
  return page(
    'Forgot your password?',
    `<form method="post" action="${action}">
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <button type="submit">Send reset link</button>
</form>`,
  );
}

// The whole point: this text is identical whether or not the address
// exists, and the route must reach it either way — see
// #/usecase/reset-password.ts's requestPasswordReset.
export function renderResetRequestedPage(): RenderedPage {
  return page(
    'Check your email',
    `<h1>Check your email</h1>
<p>If that address has an account, we've sent a link to reset its password.</p>`,
  );
}

export function renderResetRequestFailedPage(message: string): RenderedPage {
  return page(
    "Can't send a reset link",
    `<h1>Can't send a reset link</h1>
<p>${escapeHtml(message)}</p>`,
  );
}

export function renderResetPasswordForm(tenant: string, key: string): RenderedPage {
  const action = `/tenants/${escapeHtml(tenant)}/login-actions/action-token`;
  return page(
    'Choose a new password',
    `<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Reset password</button>
</form>`,
  );
}

export function renderResetPasswordSucceededPage(): RenderedPage {
  return page(
    'Password reset',
    `<h1>Your password has been reset</h1>
<p>You can close this page and sign in with your new password.</p>`,
  );
}

export function renderResetLinkFailedPage(): RenderedPage {
  return page(
    "Can't use this link",
    `<h1>This link can't be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>`,
  );
}

// Distinct from renderResetLinkFailedPage: the link itself is still good,
// so a redeemer must be sent back to the same form rather than told to
// request a new one. Every reason is listed, not just the first.
export function renderResetPasswordWeakPage(messages: readonly string[]): RenderedPage {
  const items = messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('\n');
  return page(
    "Can't reset your password",
    `<h1>Can't reset your password</h1>
<ul>
${items}
</ul>`,
  );
}

// Distinct from renderResetLinkFailedPage: reached only when the key is
// present and unexamined, so the link itself may be perfectly good — the
// submission was just missing the one field that matters.
export function renderResetPasswordRequiredPage(): RenderedPage {
  return page(
    "Can't reset your password",
    `<h1>Can't reset your password</h1>
<p>A new password is required.</p>`,
  );
}

// An actions link's own page, shown before anything is consumed: a link
// scanner's GET must not spend it. A password field only where the link
// asks for one.
export function renderRequiredActionsForm(
  tenant: string,
  key: string,
  actionLabels: readonly string[],
  setsPassword: boolean,
): RenderedPage {
  const action = `/tenants/${escapeHtml(tenant)}/login-actions/action-token`;
  const items = actionLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('\n');
  const password = setsPassword
    ? '\n  <label>New password <input type="password" name="password" autocomplete="new-password"></label>'
    : '';
  return page(
    'Update your account',
    `<h1>Update your account</h1>
<p>Your administrator asks you to:</p>
<ul>
${items}
</ul>
<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">${password}
  <button type="submit">Continue</button>
</form>`,
  );
}

export function renderRequiredActionsSucceededPage(
  remaining: readonly string[],
  redirectUri: string | null,
): RenderedPage {
  const rest =
    remaining.length === 0
      ? '<p>You can close this page and sign in.</p>'
      : `<p>Sign in to finish:</p>
<ul>
${remaining.map((label) => `<li>${escapeHtml(label)}</li>`).join('\n')}
</ul>`;
  const back =
    redirectUri === null
      ? ''
      : `\n<p><a href="${escapeHtml(redirectUri)}">Back to the application</a></p>`;
  return page(
    'Account updated',
    `<h1>Your account is updated</h1>
${rest}${back}`,
  );
}
