// What the landing page says, apart from how it is laid out. Every `to` is a
// route the build checks, and a test ties the command to the quick start's.

export const RELEASE_URL =
  'https://github.com/wizzywit/odudu/releases/download/v0.1.0-rc.4/compose.yaml';

// The caveat both the landing page and the Quick start carry until a stable
// release is in the changelog; the address then becomes the `latest` one.
export const RELEASE_CAVEAT = 'This is a release candidate';

export type Shell = 'unix' | 'windows';

export interface ShellCommand {
  shell: Shell;
  label: string;
  command: string;
}

export const COMMANDS: ShellCommand[] = [
  {
    shell: 'unix',
    label: 'bash or zsh',
    command: `curl -fsSLO ${RELEASE_URL} && docker compose up -d`,
  },
  {
    shell: 'windows',
    label: 'PowerShell',
    command: `curl.exe -fsSLO ${RELEASE_URL}; if ($?) { docker compose up -d }`,
  },
];

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
    title: 'Services and delegation',
    body: "Client credentials for a service that signs in as itself, and token exchange for acting on someone else's behalf.",
    to: '/guides/machine-to-machine/',
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

export interface Step {
  title: string;
  body: string;
}

export const STEPS: Step[] = [
  {
    title: 'Start it',
    body: 'One command downloads the Compose file and starts Postgres, a one-time setup step and the server.',
  },
  {
    title: 'Sign in to the console',
    body: "The setup step prints the console address and the first administrator's sign-in, once.",
  },
  {
    title: 'Sign a person in to an app',
    body: 'Make a tenant, register an app and sign someone in, from the console or the command line.',
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

export const WORDPRESS = {
  lead: 'Also a hand-tested guide: ',
  link: 'sign in to WordPress',
  end: '.',
  to: '/guides/wordpress/',
};

export interface PageShotCard {
  name: string;
  caption: string;
  alt: string;
  size: 'large' | 'small';
  note?: string;
}

export const PAGE_SHOTS: PageShotCard[] = [
  {
    name: 'sign-in',
    caption: 'Sign in',
    size: 'large',
    alt: 'The sign-in page: a username and a password, a Remember me box, and links to reset a password or create an account.',
  },
  {
    name: 'create-account',
    caption: 'Create an account',
    size: 'large',
    alt: 'The create-account page: a username, an email address and a password, with the rules the password has to meet.',
  },
  {
    name: 'reset-password',
    caption: 'Reset a password',
    size: 'small',
    note: 'A person asks for a link by email and chooses a new password.',
    alt: 'The reset page: an email address, a Send reset link button and a link back to sign in.',
  },
  {
    name: 'second-factor',
    caption: 'Second factor',
    size: 'small',
    note: 'Asked after the password: a code from an authenticator app, or a recovery code.',
    alt: 'The second-factor page: a field for the code from an authenticator app, and one for a recovery code.',
  },
];

export const PLANNED_LABEL = 'Planned';
export const ROADMAP_NEXT = '/roadmap/#next';

// A claim about work that has not shipped. Each quote is a phrase of the
// roadmap's Next or Later lines that the claim repeats word for word, and a
// test fails when either side stops saying it.
export interface Planned {
  id: string;
  title: string;
  claim: string;
  quotes: string[];
}

export const AGENT_ITEMS: Planned[] = [
  {
    id: 'mcp-server',
    title: 'An MCP server',
    claim:
      'The admin API as tools for an AI agent, read-only by default. A guide to protecting an MCP server with Odudu.',
    quotes: [
      'The admin API as tools for an AI agent',
      'read-only by default',
      'a guide to protecting an MCP server with Odudu',
    ],
  },
  {
    id: 'agent-identity',
    title: 'Agent identity',
    claim: 'Budgets and approval for AI agents acting for a person.',
    quotes: ['Budgets', 'approval for AI agents acting for a person'],
  },
];

export const MARKDOWN_LINE = {
  before: 'Every page also comes as Markdown, and ',
  link: 'llms.txt',
  after: ' lists them.',
};

export interface BrandingItem {
  id: string;
  title: string;
  claim: string;
  legend: string;
  caption: string;
  alt: { odudu: string; other: string };
  guide: { label: string; path: string };
}

export const BRANDING: BrandingItem = {
  id: 'branding',
  title: 'Branding and theming',
  claim:
    "Every page the server shows can wear a tenant's theme: its colours and font, a logo and a background image, one stylesheet and one page template per page kind. A client can brand its own pages over the tenant's, piece by piece. A draft is previewed on the real page, published as a version and restorable. Colours are checked for contrast before a theme publishes, and a stylesheet may name only the pages' documented classes, so a theme cannot run script or load anything from elsewhere. The address-verification mail follows the tenant's theme.",
  legend: 'The same sign-in page in two looks, both drawn by the server',
  caption: 'Same page and same markup. The second look is a tenant theme.',
  alt: {
    odudu:
      "The sign-in page in Odudu's own look: its mark and name above the form, on a plain grid.",
    other:
      "The same sign-in page in a tenant's theme: the tenant's purple colours, a monospaced font, a round logo and a soft purple background behind the form.",
  },
  guide: { label: 'Branding in the console', path: '/admin-console/branding/' },
};

export const EXAMPLES_URL_PATH = '/tree/main/examples';
export const LICENSING_URL_PATH = '/blob/main/LICENSING.md';

// What the quick start's second step shows, which the hero's terminal plays
// after the command. A test holds each line to the quick start's own text.
export const FOLLOW_UP = {
  command: 'docker compose logs setup',
  output: ['Odudu is ready.', ' console:  http://localhost:3000/console/'],
} as const;

const CLAIM_TEXT: Record<string, string> = {
  passwords: 'Passwords',
  passkeys: 'Passkeys',
  'authenticator-codes': 'Authenticator codes',
  'single-sign-on': 'Single sign-on across one tenant',
  'back-channel-logout': 'Back-channel logout',
};

// The words for a capability the scene names; the capability is its own text if unknown.
export function claimText(claim: string): string {
  return CLAIM_TEXT[claim] ?? claim;
}
