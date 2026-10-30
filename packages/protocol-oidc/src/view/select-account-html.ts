import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { fillPage } from '#/view/template';
import { bdi, t, tHtml } from '#/view/messages';

export interface SelectAccountEntry {
  sessionId: string;
  displayName: string;
}

export interface SelectAccountInput {
  tenant: string;
  authSessionId: string;
  accounts: readonly SelectAccountEntry[];
}

// The name is the account's own, so it is isolated from the page around it.
function renderAccount(account: SelectAccountEntry): string {
  const sessionId = escapeHtml(account.sessionId);
  return `<button type="submit" name="session_id" value="${sessionId}" class="secondary choice">${bdi(account.displayName)}</button>`;
}

// The hidden field is this page's CSRF defence, exactly as renderConsentPage's
// is: a submission whose auth_session_id does not name a live authentication
// session is refused, and that protects the endpoint rather than any one
// control. There is no script on this page, so `script` is null.
export function renderSelectAccountPage(
  input: SelectAccountInput,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(input.tenant))}/login-actions/select-account`;
  const accountList = input.accounts.map(renderAccount).join('\n  ');
  return page(
    t(locale, 'selectAccount.title'),
    fillPage(
      'select-account',
      {
        intro: intro(tHtml(locale, 'selectAccount.title'), input.tenant),
        'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(input.authSessionId)}">`,
        accounts: accountList,
        'submit.other': `<button type="submit" name="use_other" value="1" class="quiet">${tHtml(locale, 'selectAccount.useOther')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'select-account',
  );
}
