import { TENANT_NAME_RULE, UNSAFE_RETURN_TO } from '@odudu/contracts';
import { isTenantName, SYSTEM_TENANT, type Principal } from '#/shared/service/principal.ts';
import type { GatewayResult, Problem } from '#/shared/service/result.ts';
import { isSessionEnded } from '#/shared/service/sessionEnded.ts';

export {
  isTenantName,
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';

const ROOT = '/console/';
const RESOLVE_AGAINST = 'http://console.invalid';
// Sign-in and the API are the gateway's own routes, not pages to return to.
const NOT_PAGES = ['/console/auth/', '/console/api/'];

// Where a sign-in comes back to: a console page on this origin, never a
// gateway route or anywhere else. Anything doubtful is the console root.
export function returnPath(asked: string): string {
  if (!asked.startsWith('/') || asked.startsWith('//') || UNSAFE_RETURN_TO.test(asked)) {
    return ROOT;
  }
  const url = new URL(asked, RESOLVE_AGAINST);
  if (url.origin !== RESOLVE_AGAINST) return ROOT;
  if (url.pathname === '/console') return ROOT;
  if (!url.pathname.startsWith(ROOT) || NOT_PAGES.some((p) => url.pathname.startsWith(p))) {
    return ROOT;
  }
  return `${url.pathname}${url.search}`;
}

export function loginUrl(tenant: string, returnTo: string): string {
  const query = new URLSearchParams({ tenant, return_to: returnPath(returnTo) });
  return `/console/auth/login?${query.toString()}`;
}

// The words a refused tenant name is answered with, as a sentence.
export const TENANT_NAME_PROBLEM = `${TENANT_NAME_RULE.charAt(0).toUpperCase()}${TENANT_NAME_RULE.slice(1)}.`;

// The query parameter the gateway's callback names an authorization error in.
export const LOGIN_ERROR = 'login_error';

const TRY_AGAIN = 'The tenant needs you to finish signing in on its own page. Try again.';
const REFUSED =
  "The tenant refused the console's sign-in request. Try again, and tell the tenant's operator if it keeps happening.";

// RFC 6749 §4.1.2.1's codes, and OpenID Connect Core §3.1.2.6's, in words.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  access_denied: 'Sign-in was cancelled.',
  temporarily_unavailable: "The tenant's sign-in is unavailable just now. Try again shortly.",
  server_error: "The tenant's sign-in failed on its side. Try again.",
  login_required: TRY_AGAIN,
  interaction_required: TRY_AGAIN,
  consent_required: TRY_AGAIN,
  account_selection_required: TRY_AGAIN,
  invalid_request: REFUSED,
  invalid_request_uri: REFUSED,
  unauthorized_client: REFUSED,
  unsupported_response_type: REFUSED,
  invalid_scope: REFUSED,
};

export function loginErrorMessage(code: string): string {
  return Object.hasOwn(LOGIN_ERRORS, code)
    ? (LOGIN_ERRORS[code] ?? '')
    : 'Sign-in did not complete. Try again.';
}

export function draftOwner(principal: Principal): string {
  return `${principal.tenant}/${principal.subjectId}`;
}

// A tenant administrator opening another tenant's console is asked first:
// signing in there replaces this session. A system administrator enters.
export function signedInElsewhere(principal: Principal | null, tenant: string): boolean {
  return principal !== null && principal.tenant !== tenant && principal.tenant !== SYSTEM_TENANT;
}

export function tenantPage(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}`;
}

// A session read that answers within this is over before a placeholder
// would be seen, so none is drawn.
export const PLACEHOLDER_DELAY_MS = 200;

// What the session query holds. `was` is who this tab was showing when its
// session ended, or when a sign-in in another tab replaced it with the
// principal `result` names.
export interface SessionRead {
  result: GatewayResult<Principal>;
  was: Principal | null;
}

// The principal the tab is showing: the one it read, or while it asks about
// a replacement, the one it read before that.
export function shownPrincipal(read: SessionRead | undefined): Principal | null {
  if (read?.result.ok !== true) return null;
  return read.was ?? read.result.data;
}

export type BootState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'replaced'; was: Principal; now: Principal }
  | { kind: 'ready'; principal: Principal | null; ended: Principal | null };

export function bootOf(read: SessionRead | undefined): BootState {
  if (read === undefined) return { kind: 'loading' };
  const { result, was } = read;
  if (result.ok) {
    return was === null
      ? { kind: 'ready', principal: result.data, ended: null }
      : { kind: 'replaced', was, now: result.data };
  }
  if (result.kind === 'problem' && isSessionEnded(result.problem)) {
    return { kind: 'ready', principal: null, ended: was };
  }
  return { kind: 'failed' };
}

// A read naming somebody other than the principal shown is another tab's
// sign-in.
export function isReplacement(shown: Principal, now: Principal): boolean {
  return draftOwner(shown) !== draftOwner(now);
}

// The tenant this browser last signed in to is only a fallback: a tenant
// the URL names, or a live session, always comes first.
export function remembers(named: string | null, signedIn: boolean): boolean {
  return named === null && !signedIn;
}

export type SignOutAnswer =
  | { ok: true }
  | { ok: false; kind: 'network' | 'schema' }
  | { ok: false; kind: 'problem'; problem: Problem };

// The session is gone once the gateway has answered for it: signed out, or
// already ended, or signed out with a redirect the console will not follow.
export function sessionGone(result: SignOutAnswer): boolean {
  return (
    result.ok ||
    result.kind === 'schema' ||
    (result.kind === 'problem' && isSessionEnded(result.problem))
  );
}

// The admin API answers a tenant it does not know with a plain 401, and the
// gateway passes that through with the session kept; a 401 that ended the
// session carries the gateway's own problem type instead.
export function isUnknownTenant(result: GatewayResult<unknown> | undefined): boolean {
  return (
    result?.ok === false &&
    result.kind === 'problem' &&
    result.problem.status === 401 &&
    result.problem.type === 'about:blank'
  );
}

// Whether the tenant in the address exists, as far as whoami can say:
// undefined until it answers. Only a system administrator reaches a tenant
// other than their own, so only their 401 can mean that none has the name.
export function tenantMissing(
  principal: Principal | null,
  tenant: string,
  refusedUnknown: boolean | undefined,
): boolean | undefined {
  if (principal?.tenant !== SYSTEM_TENANT || tenant === SYSTEM_TENANT) {
    return refusedUnknown === undefined ? undefined : false;
  }
  return refusedUnknown;
}

export function isSystemPrincipal(principal: Principal | null): boolean {
  return principal?.tenant === SYSTEM_TENANT;
}

// A tenant administrator's session is the one a sign-in elsewhere replaces.
export function replacedSession(principal: Principal | null): Principal | null {
  return principal !== null && !isSystemPrincipal(principal) ? principal : null;
}

// A system administrator enters a tenant rather than signing in to it.
export function entersDirectly(principal: Principal | null, tenant: string): boolean {
  return principal !== null && (isSystemPrincipal(principal) || principal.tenant === tenant);
}

export function namedTenant(asked: string | null): string | null {
  return asked !== null && isTenantName(asked) ? asked : null;
}

export function tenantProblem(tenant: string): string | undefined {
  return isTenantName(tenant) ? undefined : TENANT_NAME_PROBLEM;
}

export const CHOOSE_TENANT = 'choose';
export const SWITCH_HREF = `/console/?${CHOOSE_TENANT}`;

export type HomeTarget =
  | { kind: 'elsewhere'; principal: Principal; tenant: string }
  | { kind: 'leaving'; tenant: string }
  | { kind: 'choose' };

// A signed-in administrator goes on to their tenant; a tenant named by
// ?tenant= goes straight to its sign-in, unless it would replace another
// tenant's session; otherwise the question is asked, and ?choose asks it of
// a signed-in administrator too.
export function homeTarget({
  principal,
  named,
  choosing,
}: {
  principal: Principal | null;
  named: string | null;
  choosing: boolean;
}): HomeTarget {
  if (named !== null && principal !== null && signedInElsewhere(principal, named)) {
    return { kind: 'elsewhere', principal, tenant: named };
  }
  const tenant = named ?? (principal !== null && !choosing ? principal.tenant : null);
  return tenant === null ? { kind: 'choose' } : { kind: 'leaving', tenant };
}

export function loginNotice(code: string | null): string | null {
  return code === null ? null : loginErrorMessage(code);
}

export function switchFailedText(failed: string, signedInTo: string): string {
  return `The switch to another tenant did not complete: ${failed} You're still signed in to ${signedInTo}.`;
}

export const SIGN_OUT_FAILED = 'Could not sign out. Try again.';

// A session that ended signs in again where it was issued, which for a
// system administrator is `system`.
export function signInHome(ended: Principal | null, tenant: string): string {
  return ended?.tenant ?? tenant;
}

export type TenantEntry =
  | { kind: 'allowed'; principal: Principal }
  | { kind: 'signing-in'; tenant: string; ended: boolean }
  | { kind: 'elsewhere'; principal: Principal };

export function tenantEntry(
  principal: Principal | null,
  ended: Principal | null,
  tenant: string,
): TenantEntry {
  if (principal === null) {
    return { kind: 'signing-in', tenant: signInHome(ended, tenant), ended: ended !== null };
  }
  return signedInElsewhere(principal, tenant)
    ? { kind: 'elsewhere', principal }
    : { kind: 'allowed', principal };
}

export function signInLabel(enters: boolean, tenant: string): string {
  if (!enters) return 'Continue to sign-in';
  return tenant === '' ? 'Enter tenant' : `Enter ${tenant}`;
}

export function signingInTitle(ended: boolean): string {
  return ended ? 'Your session ended' : 'Signing in';
}

export function signingInText(tenant: string | null): string {
  return tenant === null ? 'Opening the console…' : `Taking you to ${tenant}'s sign-in…`;
}
