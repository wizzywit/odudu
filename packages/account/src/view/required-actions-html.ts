import { type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';

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
