import { type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';

export interface SelectAccountEntry {
  sessionId: string;
  displayName: string;
}

export interface SelectAccountInput {
  realm: string;
  authSessionId: string;
  accounts: readonly SelectAccountEntry[];
}

function renderAccount(account: SelectAccountEntry): string {
  const sessionId = escapeHtml(account.sessionId);
  const displayName = escapeHtml(account.displayName);
  return `<button type="submit" name="session_id" value="${sessionId}">${displayName}</button>`;
}

// The hidden field is this page's CSRF defence, exactly as renderConsentPage's
// is: a submission whose auth_session_id does not name a live authentication
// session is refused, and that protects the endpoint rather than any one
// control. There is no script on this page, so `script` is null.
export function renderSelectAccountPage(input: SelectAccountInput): RenderedPage {
  const action = `/realms/${escapeHtml(input.realm)}/login-actions/select-account`;
  const accountList = input.accounts.map(renderAccount).join('\n  ');
  return page(
    'Choose an account',
    `<h1>Choose an account</h1>
<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(input.authSessionId)}">
  ${accountList}
  <button type="submit" name="use_other" value="1">Use another account</button>
</form>`,
  );
}
