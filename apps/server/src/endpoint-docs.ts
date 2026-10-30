const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const ENDPOINT_AUTH = [
  'None',
  'Sign-in session',
  'Mailed link token',
  'Client authentication',
  'Access token',
  'Initial access token (optional)',
  'Session cookie or ID token hint',
  'Console session',
] as const;

export type EndpointAuth = (typeof ENDPOINT_AUTH)[number];

interface EndpointDoc {
  readonly auth: EndpointAuth;
  readonly purpose: string;
}

export interface ServedEndpoint {
  readonly method: string;
  readonly url: string;
}

export function endpointKey(endpoint: ServedEndpoint): string {
  return `${endpoint.method} ${endpoint.url}`;
}

const OIDC = '/tenants/:tenant/protocol/openid-connect';
const LOGIN = '/tenants/:tenant/login-actions';

// Routes that exist only so a path nothing else claims answers `404` rather than
// falling through to a shallower wildcard (`claimPrefix` in the console gateway), and
// the CORS preflight responder `@fastify/cors` registers. Not endpoints a client calls.
const CLAIMED_PREFIXES = ['/console/auth', '/console/api'] as const;

export const NOT_LISTED: ReadonlySet<string> = new Set([
  'OPTIONS *',
  ...CLAIMED_PREFIXES.flatMap((prefix) =>
    ALL_METHODS.flatMap((method) => [`${method} ${prefix}`, `${method} ${prefix}/*`]),
  ),
]);

// Every endpoint but the admin API's operations, which its OpenAPI document
// lists. Keyed by method and path as Fastify spells it, with `:tenant` for the
// tenant's name.
export const ENDPOINT_DOCS: Readonly<Record<string, EndpointDoc>> = {
  'GET /health/live': {
    auth: 'None',
    purpose: 'Liveness: answers while the process is running.',
  },
  'GET /health/ready': {
    auth: 'None',
    purpose: 'Readiness: answers `200` while the database answers, and `503` when it does not.',
  },
  'GET /admin/openapi.json': {
    auth: 'None',
    purpose: 'The OpenAPI document of the admin API, readable from any origin.',
  },
  'GET /tenants/:tenant/.well-known/openid-configuration': {
    auth: 'None',
    purpose: 'The discovery document: the tenant’s issuer, endpoints and supported features.',
  },
  [`GET ${OIDC}/certs`]: {
    auth: 'None',
    purpose: 'The JWKS: the tenant’s public signing keys.',
  },
  [`GET ${OIDC}/auth`]: {
    auth: 'None',
    purpose:
      'The authorization endpoint: starts an authorization code flow and sends the user to sign in.',
  },
  [`POST ${OIDC}/auth`]: {
    auth: 'None',
    purpose: 'The authorization endpoint, with the request sent as a form.',
  },
  [`POST ${OIDC}/token`]: {
    auth: 'Client authentication',
    purpose:
      'The token endpoint: exchanges a code, a refresh token, client credentials or a token ' +
      '(RFC 8693) for tokens.',
  },
  [`POST ${OIDC}/token/introspect`]: {
    auth: 'Client authentication',
    purpose: 'Token introspection (RFC 7662): says whether a token is active and what it carries.',
  },
  [`POST ${OIDC}/revoke`]: {
    auth: 'Client authentication',
    purpose: 'Token revocation (RFC 7009).',
  },
  [`GET ${OIDC}/userinfo`]: {
    auth: 'Access token',
    purpose: 'The UserInfo endpoint: the claims of the user an access token names.',
  },
  [`POST ${OIDC}/userinfo`]: {
    auth: 'Access token',
    purpose: 'The UserInfo endpoint, with the access token sent as a form field.',
  },
  [`GET ${OIDC}/logout`]: {
    auth: 'Session cookie or ID token hint',
    purpose: 'RP-initiated logout: the `end_session_endpoint`, which ends the user’s session.',
  },
  [`POST ${OIDC}/logout`]: {
    auth: 'Session cookie or ID token hint',
    purpose: 'RP-initiated logout with the request sent as a form, and the confirmation form.',
  },
  'POST /tenants/:tenant/clients-registrations/openid-connect': {
    auth: 'Initial access token (optional)',
    purpose: 'Dynamic client registration (RFC 7591), when the tenant allows it.',
  },
  [`POST ${LOGIN}/authenticate`]: {
    auth: 'Sign-in session',
    purpose: 'Submits the sign-in form: one step of the tenant’s authentication flow.',
  },
  [`POST ${LOGIN}/consent`]: {
    auth: 'Sign-in session',
    purpose: 'Submits the consent screen: allow or deny.',
  },
  [`POST ${LOGIN}/select-account`]: {
    auth: 'Sign-in session',
    purpose: 'Submits the account chooser.',
  },
  [`POST ${LOGIN}/required-action`]: {
    auth: 'Sign-in session',
    purpose: 'Completes an action sign-in requires first, such as changing a password.',
  },
  [`POST ${LOGIN}/passkey-challenge`]: {
    auth: 'None',
    purpose: 'Returns the options for a passkey sign-in that names no user.',
  },
  [`GET ${LOGIN}/registration`]: {
    auth: 'None',
    purpose: 'The self-registration form, when the tenant allows registration.',
  },
  [`POST ${LOGIN}/registration`]: {
    auth: 'None',
    purpose: 'Submits a self-registration.',
  },
  [`GET ${LOGIN}/action-token`]: {
    auth: 'Mailed link token',
    purpose:
      'Redeems a mailed link: verify an email address, reset a password, or required actions.',
  },
  [`POST ${LOGIN}/action-token`]: {
    auth: 'Mailed link token',
    purpose: 'Submits a new password, or the required actions, against a mailed link.',
  },
  [`GET ${LOGIN}/reset-password`]: {
    auth: 'None',
    purpose: 'The form that asks for a password reset link.',
  },
  [`POST ${LOGIN}/reset-password`]: {
    auth: 'None',
    purpose: 'Requests a password reset link by mail.',
  },
  'GET /instrument/*': {
    auth: 'None',
    purpose: 'The stylesheet, mark, icons and fonts every server-rendered page links.',
  },
  'GET /tenants/:tenant/brand/:file': {
    auth: 'None',
    purpose:
      'An image a tenant’s published theme names, or its hashed stylesheet, at a URL made of the file’s SHA-256 and type; cached for a year.',
  },
  'GET /tenants/:tenant/brand/c/:client/:file': {
    auth: 'None',
    purpose:
      'The hashed stylesheet a client’s published theme makes over the tenant’s, at a URL naming the client by its row id.',
  },
  'GET /favicon.ico': {
    auth: 'None',
    purpose: 'The favicon, for browsers that ask for it without a page linking one.',
  },
  'GET /docs': {
    auth: 'None',
    purpose:
      'Redirects to the form with the trailing slash, the documentation that ships with the server.',
  },
  'GET /docs/*': {
    auth: 'None',
    purpose:
      'The documentation built into the image: its pages, search index and Markdown copies. Off with `ODUDU_DOCS=false`.',
  },
  'GET /console': {
    auth: 'None',
    purpose: 'Redirects to `/console/`, the admin console.',
  },
  'GET /console/*': {
    auth: 'None',
    purpose: 'The admin console\u2019s single-page app: its shell and static files.',
  },
  'GET /console/auth/login': {
    auth: 'None',
    purpose:
      'Starts the console\u2019s sign-in for the tenant in the `tenant` query parameter, by sending the browser to that tenant\u2019s authorization endpoint.',
  },
  'GET /console/auth/callback': {
    auth: 'None',
    purpose: 'Receives the authorization response, redeems the code and starts a console session.',
  },
  'POST /console/auth/logout': {
    auth: 'Console session',
    purpose:
      'Ends the console session, clears its cookie and answers where to send the browser to finish signing out.',
  },
  'GET /console/api/session': {
    auth: 'Console session',
    purpose: 'Says which tenant and user the console session belongs to.',
  },
  'GET /console/api/tenants/:tenant/discovery': {
    auth: 'Console session',
    purpose: 'A tenant\u2019s discovery document, with the issuer the public address gives.',
  },
  'GET /console/api/tenants/:tenant/jwks': {
    auth: 'Console session',
    purpose: 'A tenant\u2019s public signing keys.',
  },
  ...Object.fromEntries(
    ALL_METHODS.map((method) => [
      `${method} /console/api/admin/*`,
      {
        auth: 'Console session',
        purpose:
          'Forwards an admin API call under `/admin/` with the console\u2019s own credentials for the signed-in user.',
      },
    ]),
  ),
};
