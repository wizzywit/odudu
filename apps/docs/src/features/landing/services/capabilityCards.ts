// The cards and links the landing page shows. Every `to` is a route the build checks.

export interface Card {
  title: string;
  body: string;
  to: string;
}

export const CAPABILITIES: Card[] = [
  {
    title: 'Standard sign-in',
    body: 'The authorization code flow with PKCE always on, and discovery, signing keys, user info, introspection and revocation for every tenant.',
    to: '/guides/sign-a-user-in/',
  },
  {
    title: 'Many tenants',
    body: 'Any number of tenants on one server, each with its own people, apps, keys and settings, kept apart by the database itself.',
    to: '/concepts/tenants/',
  },
  {
    title: 'Passwords and second factors',
    body: 'Passwords with a policy and lockouts, passkeys, authenticator apps and recovery codes, chosen per tenant.',
    to: '/admin-console/sign-in-flow/',
  },
  {
    title: 'Sessions that end properly',
    body: 'Refresh tokens that rotate and are caught when stolen, and logout that reaches the apps that registered for it.',
    to: '/guides/refresh-and-end-a-session/',
  },
  {
    title: 'Services and agents',
    body: "Client credentials for a service that signs in as itself, token exchange for acting on someone else's behalf, and an MCP server with 44 read tools and 2 write tools over the admin API.",
    to: '/guides/protect-an-mcp-server/',
  },
  {
    title: 'An admin API and console',
    body: 'More than a hundred operations, each checked against the capability it needs, and a console with a page for every area.',
    to: '/admin-console/',
  },
  {
    title: 'An audit trail',
    body: 'Every administrative change, sign-in, refusal and token is recorded, filterable and exportable.',
    to: '/admin-console/audit-trail/',
  },
  {
    title: 'One container and Postgres',
    body: 'Migrations run at boot, health endpoints are built in, and TLS is ended in front of the server.',
    to: '/operating/deploying/',
  },
];

export const READERS: Card[] = [
  {
    title: 'I am building an app',
    body: 'Pick the guide for a web app, a single-page app, an API or a service. Each ends with a working sign-in.',
    to: '/guides/',
  },
  {
    title: 'I administer people and apps',
    body: 'A tour of the console: tenants, people, apps, keys and the audit trail.',
    to: '/admin-console/tour/',
  },
  {
    title: 'I run the server',
    body: 'Deploy, configure, upgrade, back up and scale an installation.',
    to: '/operating/',
  },
  {
    title: 'I am choosing a provider',
    body: 'What Odudu does today, what it does not, and where each capability is shown working.',
    to: '/introduction/compare/',
  },
];

export const EXAMPLES: Card[] = [
  {
    title: 'Web app',
    body: 'A server-side app that signs a person in with the authorization code grant and PKCE, and keeps them in a session.',
    to: '/guides/web-app/',
  },
  {
    title: 'Single-page app',
    body: 'A browser app with no secret that signs in with PKCE, keeps its tokens in memory and signs out.',
    to: '/guides/single-page-app/',
  },
  {
    title: 'API',
    body: 'An API that decides for itself whether to trust an access token: signature, issuer, audience, type and expiry.',
    to: '/guides/api/',
  },
  {
    title: 'Service to service',
    body: 'A service that signs in as itself with a secret and calls the API.',
    to: '/guides/machine-to-machine/',
  },
];

export interface WordpressLine {
  lead: string;
  link: string;
  end: string;
  to: string;
}

export const WORDPRESS: WordpressLine = {
  lead: 'Also a hand-tested guide: ',
  link: 'sign in to WordPress',
  end: '.',
  to: '/guides/wordpress/',
};

export interface MarkdownLine {
  before: string;
  link: string;
  after: string;
}

export const MARKDOWN_LINE: MarkdownLine = {
  before: 'Every page also comes as Markdown, and ',
  link: 'llms.txt',
  after: ' lists them.',
};

export const EXAMPLES_URL_PATH = '/tree/main/examples';
export const LICENSING_URL_PATH = '/blob/main/LICENSING.md';
