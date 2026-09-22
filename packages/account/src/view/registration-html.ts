import { type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';

export function renderRegistrationForm(tenant: string): RenderedPage {
  const action = `/tenants/${escapeHtml(tenant)}/login-actions/registration`;
  return page(
    'Create account',
    `<form method="post" action="${action}">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Email <input type="email" name="email" autocomplete="email"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Create account</button>
</form>`,
  );
}

// Every reason the submission was refused is listed, not just the first: a
// password policy with four rules should not take four submissions to
// satisfy.
export function renderRegistrationFailedPage(messages: readonly string[]): RenderedPage {
  const items = messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('\n');
  return page(
    "Can't create this account",
    `<h1>Can't create this account</h1>
<ul>
${items}
</ul>`,
  );
}

// The word "verify" only appears here when the tenant actually requires it —
// the whole point is that an unverified account cannot sign in yet, so the
// page must not claim otherwise.
export function renderRegistrationSucceededPage(verifyEmailRequired: boolean): RenderedPage {
  const next = verifyEmailRequired
    ? '<p>Check your email for a link to verify your address before you can sign in.</p>'
    : '<p>You can now sign in.</p>';
  return page(
    'Account created',
    `<h1>Account created</h1>
${next}`,
  );
}
