import { type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';

export interface ConsentPageInput {
  tenant: string;
  authSessionId: string;
  // Self-asserted by the client at registration (RFC 7591 §5) — escaped
  // like every other interpolated value, the client's name most of all.
  clientName: string;
  // RFC 7591 §2's pages, as registered: https, or http on loopback, already
  // refused otherwise when the client was written.
  clientPages: {
    readonly clientUri: string | null;
    readonly policyUri: string | null;
    readonly tosUri: string | null;
  };
  defaultScopes: readonly string[];
  optionalScopes: readonly string[];
  alreadyGranted: readonly string[];
  // An administrator's words for a scope, shown in place of its name.
  scopeLabels: Readonly<Record<string, string>>;
}

function labelOf(scope: string, labels: ConsentPageInput['scopeLabels']): string {
  return Object.hasOwn(labels, scope) ? (labels[scope] ?? scope) : scope;
}

function renderDefaultScope(scope: string, labels: ConsentPageInput['scopeLabels']): string {
  return `<li>${escapeHtml(labelOf(scope, labels))}</li>`;
}

// OIDC Core §16.18's SHOULD: "the authorization server clearly identifies
// long-term grants to the user during authorization". `offline_access` is
// the one scope this server defines that asks for exactly that (RFC 6749
// §1.5's refresh token, outliving the browser session that requested it) —
// naming it, not merely listing it alongside every other optional scope, is
// what the clause asks for.
const LONG_TERM_GRANT_NOTE: ReadonlyMap<string, string> = new Map([
  ['offline_access', ' — grants ongoing access, even while you are not present'],
]);

function renderOptionalScope(
  scope: string,
  granted: ReadonlySet<string>,
  labels: ConsentPageInput['scopeLabels'],
): string {
  const checked = granted.has(scope) ? ' checked' : '';
  const label = escapeHtml(labelOf(scope, labels));
  const note = escapeHtml(LONG_TERM_GRANT_NOTE.get(scope) ?? '');
  return `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}"${checked}> ${label}${note}</label>`;
}

function renderPageLinks(pages: ConsentPageInput['clientPages'], clientName: string): string {
  const links = [
    [pages.clientUri, `About ${clientName}`],
    [pages.policyUri, 'Privacy policy'],
    [pages.tosUri, 'Terms of service'],
  ]
    .filter((link): link is [string, string] => link[0] !== null)
    .map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
  return links.length === 0 ? '' : `\n<p>${links.join(' · ')}</p>`;
}

// The hidden field is the whole of this page's CSRF defence, exactly as
// renderLoginForm's is (packages/protocol-oidc/src/view/authorize-html.ts:130):
// a submission whose auth_session_id does not name a live authentication
// session is refused, and that protects the endpoint rather than any one
// control. There is no script on this page, so `script` is null and
// `default-src 'none'` describes it exactly.
export function renderConsentPage(input: ConsentPageInput): RenderedPage {
  const action = `/tenants/${escapeHtml(input.tenant)}/login-actions/consent`;
  const granted = new Set(input.alreadyGranted);
  const defaultList = input.defaultScopes
    .map((scope) => renderDefaultScope(scope, input.scopeLabels))
    .join('\n  ');
  const optionalList = input.optionalScopes
    .map((scope) => renderOptionalScope(scope, granted, input.scopeLabels))
    .join('\n  ');
  return page(
    'Allow access?',
    `<h1>${escapeHtml(input.clientName)} is asking for access</h1>${renderPageLinks(input.clientPages, input.clientName)}
<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(input.authSessionId)}">
  <ul>
  ${defaultList}
  </ul>
  ${optionalList}
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}
