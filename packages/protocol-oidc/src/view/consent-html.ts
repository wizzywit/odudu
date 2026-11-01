import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import {
  consentClientName,
  consentScopeTexts,
  NO_CONSENT_I18N,
  type ConsentI18n,
} from '#/service/consent-i18n';
import { fillPage } from '#/view/template';
import { bdi, t, tHtml } from '#/view/messages';

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
  // The same wording in other languages, for the page's own to replace these.
  i18n?: ConsentI18n;
}

function labelOf(scope: string, labels: ConsentPageInput['scopeLabels']): string {
  return Object.hasOwn(labels, scope) ? (labels[scope] ?? scope) : scope;
}

// A label is an administrator's own wording and a bare scope name is a tenant's,
// so each is isolated from the sentence around it.
function renderDefaultScope(scope: string, labels: ConsentPageInput['scopeLabels']): string {
  return `<li>${bdi(labelOf(scope, labels))}</li>`;
}

// OIDC Core §16.18's SHOULD: "the authorization server clearly identifies
// long-term grants to the user during authorization". `offline_access` is
// the one scope this server defines that asks for exactly that (RFC 6749
// §1.5's refresh token, outliving the browser session that requested it) —
// naming it, not merely listing it alongside every other optional scope, is
// what the clause asks for.
const LONG_TERM_GRANT_SCOPE = 'offline_access';

function renderOptionalScope(
  scope: string,
  granted: ReadonlySet<string>,
  labels: ConsentPageInput['scopeLabels'],
  locale: PageLocale,
): string {
  const checked = granted.has(scope) ? ' checked' : '';
  const label = labelOf(scope, labels);
  const text =
    scope === LONG_TERM_GRANT_SCOPE
      ? tHtml(locale, 'consent.scope.offlineAccess', {}, { label })
      : bdi(label);
  return `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}"${checked}> ${text}</label>`;
}

function renderPageLinks(
  pages: ConsentPageInput['clientPages'],
  clientName: string,
  locale: PageLocale,
): string {
  const links = [
    [pages.clientUri, tHtml(locale, 'consent.link.about', {}, { client: clientName })],
    [pages.policyUri, tHtml(locale, 'consent.link.privacy')],
    [pages.tosUri, tHtml(locale, 'consent.link.terms')],
  ]
    .filter((link): link is [string, string] => link[0] !== null)
    .map(([href, label]) => `<a href="${escapeHtml(href)}">${label}</a>`);
  return links.length === 0 ? '' : `\n<p>${links.join(' · ')}</p>`;
}

// The hidden field is the whole of this page's CSRF defence, exactly as
// renderLoginForm's is (packages/protocol-oidc/src/view/authorize-html.ts:130):
// a submission whose auth_session_id does not name a live authentication
// session is refused, and that protects the endpoint rather than any one
// control. There is no script on this page, so `script` is null and
// `default-src 'none'` describes it exactly.
export function renderConsentPage(input: ConsentPageInput, locale: PageLocale): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(input.tenant))}/login-actions/consent`;
  const granted = new Set(input.alreadyGranted);
  const i18n = input.i18n ?? NO_CONSENT_I18N;
  const clientName = consentClientName(input.clientName, i18n, locale.tag);
  const labels = consentScopeTexts(input.scopeLabels, i18n, locale.tag);
  const defaultList = input.defaultScopes
    .map((scope) => renderDefaultScope(scope, labels))
    .join('\n  ');
  const optionalList = input.optionalScopes
    .map((scope) => renderOptionalScope(scope, granted, labels, locale))
    .join('\n  ');
  return page(
    t(locale, 'consent.title'),
    fillPage(
      'consent',
      {
        client: intro(tHtml(locale, 'consent.heading', {}, { client: clientName }), input.tenant),
        links: renderPageLinks(input.clientPages, clientName, locale),
        error: '',
        'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(input.authSessionId)}">`,
        scopes: `<ul>
  ${defaultList}
  </ul>
  ${optionalList}`,
        'submit.allow': `<button type="submit" name="decision" value="allow">${tHtml(locale, 'consent.allow')}</button>`,
        'submit.deny': `<button type="submit" name="decision" value="deny" class="secondary">${tHtml(locale, 'consent.deny')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'consent',
  );
}
