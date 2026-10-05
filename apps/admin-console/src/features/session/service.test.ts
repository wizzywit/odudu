import { describe, expect, it } from 'vitest';
import {
  bootOf,
  CHOOSE_TENANT,
  draftOwner,
  entersDirectly,
  homeTarget,
  isReplacement,
  isSystemPrincipal,
  isTenantName,
  isUnknownTenant,
  loginErrorMessage,
  loginNotice,
  loginUrl,
  namedTenant,
  remembers,
  replacedSession,
  returnPath,
  sessionGone,
  shownPrincipal,
  signInLabel,
  signingInText,
  signingInTitle,
  SIGN_OUT_FAILED,
  signInHome,
  switchFailedText,
  SWITCH_HREF,
  tenantEntry,
  tenantMissing,
  tenantProblem,
  TENANT_NAME_PROBLEM,
  type Principal,
  type SessionRead,
} from '#/features/session/service.ts';
import type { GatewayResult, Problem } from '#/shared/service/result.ts';

describe('the return path a sign-in comes back to', () => {
  it('is the console page the administrator was on, query kept and fragment dropped', () => {
    expect(returnPath('/console/acme/clients/c1?tab=tokens#top')).toBe(
      '/console/acme/clients/c1?tab=tokens',
    );
    expect(returnPath('/console/')).toBe('/console/');
    expect(returnPath('/console')).toBe('/console/');
  });

  it.each([
    'https://evil.example/console/',
    '//evil.example/console/',
    '/\\evil.example/console/',
    '/elsewhere',
    '/consoles/acme',
    '/console/../admin/tenants',
    '/console/%2e%2e/admin',
    '/console/acme/%2E%2e/%2e./api/session',
    '/console/auth/login?tenant=acme',
    '/console/auth/logout',
    '/console/api/session',
    'javascript:alert(1)',
    '/console/acme%25/clients',
    '/console/acme/%0d%0aset-cookie',
    '/console/acme/%1F',
    '/console/acme/%7f',
    '/console/acme/\x7f',
    '/console/acme/\x01',
    '',
  ])('is the console root instead of %j', (asked) => {
    expect(returnPath(asked)).toBe('/console/');
  });
});

describe('the sign-in URL', () => {
  it('names the tenant and the return path, both encoded', () => {
    const url = new URL(loginUrl('acme', '/console/acme/clients?tab=a&b=c'), location.origin);
    expect(url.pathname).toBe('/console/auth/login');
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('return_to')).toBe('/console/acme/clients?tab=a&b=c');
  });

  it('never carries a return path outside the console', () => {
    const url = new URL(loginUrl('acme', 'https://evil.example/'), location.origin);
    expect(url.searchParams.get('return_to')).toBe('/console/');
  });
});

describe('a tenant name', () => {
  it.each(['acme', 'system', 'a', 'eu-west-1', 'x'.repeat(63)])('accepts %j', (name) => {
    expect(isTenantName(name)).toBe(true);
  });

  it.each(['', 'Acme', '-acme', 'acme-', 'ac me', 'ac/me', 'x'.repeat(64), 'ac.me'])(
    'refuses %j',
    (name) => {
      expect(isTenantName(name)).toBe(false);
    },
  );
});

it('keys drafts by the administrator and the tenant they signed in to', () => {
  expect(draftOwner({ tenant: 'acme', subjectId: 's1', username: 'grace' })).toBe('acme/s1');
});

describe('loginErrorMessage', () => {
  it('says in words why a tenant sign-in came back without a session', () => {
    expect(loginErrorMessage('access_denied')).toBe('Sign-in was cancelled.');
    expect(loginErrorMessage('temporarily_unavailable')).toBe(
      "The tenant's sign-in is unavailable just now. Try again shortly.",
    );
    expect(loginErrorMessage('server_error')).toBe(
      "The tenant's sign-in failed on its side. Try again.",
    );
    expect(loginErrorMessage('login_required')).toBe(
      'The tenant needs you to finish signing in on its own page. Try again.',
    );
    expect(loginErrorMessage('invalid_scope')).toBe(
      "The tenant refused the console's sign-in request. Try again, and tell the tenant's operator if it keeps happening.",
    );
  });

  it('answers any code it does not know, or a name that is no code, with a general message', () => {
    expect(loginErrorMessage('made_up')).toBe('Sign-in did not complete. Try again.');
    expect(loginErrorMessage('<script>')).toBe('Sign-in did not complete. Try again.');
  });
});

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const ada: Principal = { tenant: 'acme', subjectId: 's2', username: 'ada' };
const root: Principal = { tenant: 'system', subjectId: 's9', username: 'root' };

function problem(
  status: number,
  type = 'about:blank',
): { ok: false; kind: 'problem'; problem: Problem } {
  const body: Problem = { type, title: 'Problem', status };
  return { ok: false, kind: 'problem', problem: body };
}

function read(result: GatewayResult<Principal>, was: Principal | null = null): SessionRead {
  return { result, was };
}

function ok(principal: Principal): GatewayResult<Principal> {
  return { ok: true, status: 200, data: principal, etag: null, next: null };
}

describe('the principal a tab shows', () => {
  it('is the one read, or the one shown before a replacement was read', () => {
    expect(shownPrincipal(undefined)).toBeNull();
    expect(shownPrincipal(read(problem(401)))).toBeNull();
    expect(shownPrincipal(read(ok(grace)))).toBe(grace);
    expect(shownPrincipal(read(ok(ada), grace))).toBe(grace);
  });
});

describe('how a session read boots the console', () => {
  it('is loading until the read answers', () => {
    expect(bootOf(undefined)).toEqual({ kind: 'loading' });
  });

  it('is ready with the principal when the read names one', () => {
    expect(bootOf(read(ok(grace)))).toEqual({ kind: 'ready', principal: grace, ended: null });
  });

  it('names both principals when another tab signed somebody else in', () => {
    expect(bootOf(read(ok(ada), grace))).toEqual({ kind: 'replaced', was: grace, now: ada });
  });

  it('is ready with nobody, and whose session it was, when the gateway says it ended', () => {
    const ended = problem(401, 'about:blank#console-session-ended');
    expect(bootOf(read(ended, grace))).toEqual({ kind: 'ready', principal: null, ended: grace });
    expect(bootOf(read(ended))).toEqual({ kind: 'ready', principal: null, ended: null });
  });

  it('fails on a plain 401, any other problem, and a lost answer', () => {
    expect(bootOf(read(problem(401)))).toEqual({ kind: 'failed' });
    expect(bootOf(read(problem(500)))).toEqual({ kind: 'failed' });
    expect(bootOf(read({ ok: false, kind: 'network' }))).toEqual({ kind: 'failed' });
  });
});

describe('what a fresh session read means for the tab', () => {
  it('is no replacement when the principal and tenant are the ones shown', () => {
    expect(isReplacement(grace, { ...grace, username: 'renamed' })).toBe(false);
  });

  it('is a replacement when the subject or the tenant differs', () => {
    expect(isReplacement(grace, ada)).toBe(true);
    expect(isReplacement(grace, { ...grace, tenant: 'other' })).toBe(true);
  });
});

describe('the last tenant, remembered', () => {
  it('is offered only when no tenant is named and nobody is signed in', () => {
    expect(remembers(null, false)).toBe(true);
    expect(remembers('acme', false)).toBe(false);
    expect(remembers(null, true)).toBe(false);
  });
});

describe('whether a sign-out answer means the session is gone', () => {
  it('is yes for a sign-out, an answer that could not be read, and a session already over', () => {
    expect(sessionGone({ ok: true })).toBe(true);
    expect(sessionGone({ ok: false, kind: 'schema' })).toBe(true);
    expect(sessionGone(problem(401, 'about:blank#console-session-ended'))).toBe(true);
  });

  it('is no for any other failure', () => {
    expect(sessionGone(problem(401))).toBe(false);
    expect(sessionGone(problem(500))).toBe(false);
    expect(sessionGone({ ok: false, kind: 'network' })).toBe(false);
  });
});

describe('a tenant the admin API does not know', () => {
  it('is the plain 401 it passes through, not the gateway ended-session one', () => {
    expect(isUnknownTenant(problem(401))).toBe(true);
    expect(isUnknownTenant(problem(401, 'about:blank#console-session-ended'))).toBe(false);
    expect(isUnknownTenant(problem(403))).toBe(false);
    expect(isUnknownTenant({ ok: false, kind: 'network' })).toBe(false);
    expect(isUnknownTenant(undefined)).toBe(false);
  });

  it('is only said to be missing for a system administrator outside the system tenant', () => {
    expect(tenantMissing(root, 'ghost', true)).toBe(true);
    expect(tenantMissing(root, 'ghost', false)).toBe(false);
    expect(tenantMissing(root, 'ghost', undefined)).toBeUndefined();
  });

  it('is never missing to anybody else, once whoami has answered', () => {
    expect(tenantMissing(grace, 'acme', true)).toBe(false);
    expect(tenantMissing(grace, 'acme', false)).toBe(false);
    expect(tenantMissing(root, 'system', true)).toBe(false);
    expect(tenantMissing(grace, 'acme', undefined)).toBeUndefined();
    expect(tenantMissing(null, 'acme', undefined)).toBeUndefined();
  });
});

describe('the tenant a URL names', () => {
  it('is the one asked for when it is a tenant name, else none', () => {
    expect(namedTenant('acme')).toBe('acme');
    expect(namedTenant('Not A Tenant')).toBeNull();
    expect(namedTenant(null)).toBeNull();
  });

  it('is checked with the words a refused name is answered with', () => {
    expect(tenantProblem('acme')).toBeUndefined();
    expect(tenantProblem('Acme')).toBe(TENANT_NAME_PROBLEM);
    expect(tenantProblem('')).toBe(TENANT_NAME_PROBLEM);
  });
});

describe('who a sign-in page treats as a system administrator', () => {
  it('is a principal issued by the system tenant', () => {
    expect(isSystemPrincipal(root)).toBe(true);
    expect(isSystemPrincipal(grace)).toBe(false);
    expect(isSystemPrincipal(null)).toBe(false);
  });

  it('replaces only a tenant administrator session', () => {
    expect(replacedSession(grace)).toBe(grace);
    expect(replacedSession(root)).toBeNull();
    expect(replacedSession(null)).toBeNull();
  });

  it('enters a tenant directly when signed in as its administrator or from the system tenant', () => {
    expect(entersDirectly(grace, 'acme')).toBe(true);
    expect(entersDirectly(grace, 'other')).toBe(false);
    expect(entersDirectly(root, 'other')).toBe(true);
    expect(entersDirectly(null, 'acme')).toBe(false);
  });
});

describe('where the bare console sends the visitor', () => {
  it('asks first when an administrator of another tenant names one', () => {
    expect(homeTarget({ principal: grace, named: 'other', choosing: false })).toEqual({
      kind: 'elsewhere',
      principal: grace,
      tenant: 'other',
    });
  });

  it('goes to the tenant named, signed in or not', () => {
    expect(homeTarget({ principal: null, named: 'acme', choosing: false })).toEqual({
      kind: 'leaving',
      tenant: 'acme',
    });
    expect(homeTarget({ principal: root, named: 'other', choosing: true })).toEqual({
      kind: 'leaving',
      tenant: 'other',
    });
  });

  it('goes to the signed-in administrator own tenant unless they chose to switch', () => {
    expect(homeTarget({ principal: grace, named: null, choosing: false })).toEqual({
      kind: 'leaving',
      tenant: 'acme',
    });
    expect(homeTarget({ principal: grace, named: null, choosing: true })).toEqual({
      kind: 'choose',
    });
  });

  it('asks which tenant when nobody is signed in and none is named', () => {
    expect(homeTarget({ principal: null, named: null, choosing: false })).toEqual({
      kind: 'choose',
    });
  });

  it('has the address that asks the question anyway', () => {
    expect(SWITCH_HREF).toBe(`/console/?${CHOOSE_TENANT}`);
  });
});

describe('the words about a sign-in that came back without a session', () => {
  it('is nothing when no error came back, and the code in words otherwise', () => {
    expect(loginNotice(null)).toBeNull();
    expect(loginNotice('access_denied')).toBe('Sign-in was cancelled.');
    expect(loginNotice('made_up')).toBe('Sign-in did not complete. Try again.');
  });

  it('says what happened to a switch that left the old session standing', () => {
    expect(switchFailedText('Sign-in was cancelled.', 'acme')).toBe(
      "The switch to another tenant did not complete: Sign-in was cancelled. You're still signed in to acme.",
    );
  });

  it('says a sign-out did not finish', () => {
    expect(SIGN_OUT_FAILED).toBe('Could not sign out. Try again.');
  });
});

describe('who may open a tenant page', () => {
  it('sends nobody to sign in where they were issued, else to the tenant in the address', () => {
    expect(signInHome(null, 'acme')).toBe('acme');
    expect(signInHome(root, 'acme')).toBe('system');
    expect(tenantEntry(null, null, 'acme')).toEqual({
      kind: 'signing-in',
      tenant: 'acme',
      ended: false,
    });
    expect(tenantEntry(null, root, 'acme')).toEqual({
      kind: 'signing-in',
      tenant: 'system',
      ended: true,
    });
  });

  it('lets in the tenant own administrator and any system administrator', () => {
    expect(tenantEntry(grace, null, 'acme')).toEqual({ kind: 'allowed', principal: grace });
    expect(tenantEntry(root, null, 'acme')).toEqual({ kind: 'allowed', principal: root });
  });

  it('asks an administrator of another tenant first', () => {
    expect(tenantEntry(grace, null, 'other')).toEqual({ kind: 'elsewhere', principal: grace });
  });
});

describe('the words of the sign-in pages', () => {
  it('labels the button by whether the visitor signs in or enters', () => {
    expect(signInLabel(false, 'acme')).toBe('Continue to sign-in');
    expect(signInLabel(false, '')).toBe('Continue to sign-in');
    expect(signInLabel(true, 'acme')).toBe('Enter acme');
    expect(signInLabel(true, '')).toBe('Enter tenant');
  });

  it('titles the waiting page by whether a session ended', () => {
    expect(signingInTitle(false)).toBe('Signing in');
    expect(signingInTitle(true)).toBe('Your session ended');
  });

  it('says where the window is going, or that the console is opening', () => {
    expect(signingInText('acme')).toBe("Taking you to acme's sign-in…");
    expect(signingInText(null)).toBe('Opening the console…');
  });
});
