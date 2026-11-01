// Every `*-html.ts` renderer is either themeable, which means its body is
// built by its package's page filler, or named here with the reason no theme
// applies. `packages/protocol-oidc/src/view/theme-reach.test.ts` holds the
// two tables to the renderers on disk. Keys are repo-relative paths.
export const NO_TENANT_IN_SCOPE: Record<string, string> = {
  'packages/protocol-oidc/src/view/not-found-html.ts':
    'answers a path no route owns, before any tenant is resolved',
  'packages/protocol-oidc/src/view/server-error-html.ts':
    'answers a failure that may have happened before the tenant was known, and must not depend on a theme read',
  'packages/protocol-oidc/src/view/throttled-html.ts':
    'the request path names the tenant, but the throttle answers before any tenant lookup by design, so a refusal costs no query (a cost choice)',
  'packages/console-gateway/src/view/refusal-html.ts':
    "the console's own sign-in refusal: the console belongs to the system tenant, not to a tenant that themes pages",
};

// Where a themeable page takes its client from; a theme layers the client's
// over the tenant's. pending-request: the client of the request parked for
// this sign-in. return-to: the client a `return_to` names, once checked to
// belong to the tenant. verified-hint: the client an `id_token_hint` verified
// for, carried to the confirmation by its form token, never `client_id` alone.
// tenant: no client travels with the request.
export type ClientSource = 'pending-request' | 'return-to' | 'verified-hint' | 'tenant';

export interface ClientRule {
  readonly source: ClientSource;
  readonly why: string;
}

export const CLIENT_RULES: Record<string, ClientRule> = {
  'packages/protocol-oidc/src/view/authorize-html.ts': {
    source: 'pending-request',
    why: 'the sign-in form and its refusals belong to a parked request; the authorize error and expired sign-in pages have none and wear the tenant theme',
  },
  'packages/protocol-oidc/src/view/consent-html.ts': {
    source: 'pending-request',
    why: 'consent is asked for the client of the parked request',
  },
  'packages/protocol-oidc/src/view/select-account-html.ts': {
    source: 'pending-request',
    why: 'the chooser continues the parked request',
  },
  'packages/protocol-oidc/src/view/logout-html.ts': {
    source: 'verified-hint',
    why: 'a logout names its client in a query parameter anyone can set, so only a client the id_token_hint verified for (carried to the confirmation by the form token) is worn; otherwise the tenant theme',
  },
  'packages/authn-flows/src/view/totp-enrolment-html.ts': {
    source: 'pending-request',
    why: 'a required action interrupts a parked sign-in',
  },
  'packages/authn-flows/src/view/passkey-enrolment-html.ts': {
    source: 'pending-request',
    why: 'a required action interrupts a parked sign-in',
  },
  'packages/authn-flows/src/view/recovery-codes-html.ts': {
    source: 'pending-request',
    why: 'a required action interrupts a parked sign-in',
  },
  'packages/authn-flows/src/view/update-password-html.ts': {
    source: 'pending-request',
    why: 'a required action interrupts a parked sign-in',
  },
  'packages/authn-flows/src/view/required-action-html.ts': {
    source: 'pending-request',
    why: 'a required action interrupts a parked sign-in',
  },
  'packages/account/src/view/registration-html.ts': {
    source: 'return-to',
    why: 'the page is reached from a sign-in, which carries its return_to; a return_to naming a client of another tenant is no client',
  },
  'packages/account/src/view/reset-html.ts': {
    source: 'return-to',
    why: 'the request form carries return_to; the pages a mailed link opens carry none and wear the tenant theme',
  },
  'packages/account/src/view/verification-html.ts': {
    source: 'tenant',
    why: 'a mailed link carries no client and no flow gains a stored client id',
  },
  'packages/account/src/view/required-actions-html.ts': {
    source: 'tenant',
    why: 'a mailed link carries no client and no flow gains a stored client id',
  },
};
