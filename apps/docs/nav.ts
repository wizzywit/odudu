export interface Section {
  readonly label: string;
  readonly id: string;
  readonly route: string;
  readonly summary: string;
}

export const REPOSITORY_URL = 'https://github.com/wizzywit/odudu';
export const TRADEMARK_URL = `${REPOSITORY_URL}/blob/main/TRADEMARK.md`;

// The one place the owner is named. The README, TRADEMARK.md and brand/NOTICE.md
// carry the same sentence, and tests/lint/community-files.test.ts holds them to it.
export const OWNER_NOTICE_NAME = 'Wisdom Praise';
export const OWNER_NOTICE = `Odudu and the staff mark are the property of ${OWNER_NOTICE_NAME}. The software is licensed under the AGPL; the name and the mark are used under the trademark policy.`;

export const SECTIONS: readonly Section[] = [
  {
    label: 'Introduction',
    id: 'introduction/index',
    route: 'introduction/',
    summary: 'What Odudu is, who it is for and how the documentation is laid out.',
  },
  {
    label: 'Quick start',
    id: 'quick-start/index',
    route: 'quick-start/',
    summary:
      'Start Odudu with Docker Compose and sign in to the console as the first administrator.',
  },
  {
    label: 'Guides',
    id: 'guides/index',
    route: 'guides/',
    summary: 'Sign users in from a web app, a single-page app, an API or a machine.',
  },
  {
    label: 'SDKs',
    id: 'sdks/index',
    route: 'sdks/',
    summary:
      'Packages that sign people in, protect an API and call the admin and account APIs, with the examples that use them.',
  },
  {
    label: 'Concepts',
    id: 'concepts/index',
    route: 'concepts/',
    summary: 'Tenants, clients, tokens, sessions and the other ideas the product is built on.',
  },
  {
    label: 'Admin console',
    id: 'admin-console/index',
    route: 'admin-console/',
    summary: 'A tour of the console and one page for each area it manages.',
  },
  {
    label: 'Operating Odudu',
    id: 'operating/index',
    route: 'operating/',
    summary: 'Deploy, configure, upgrade, back up and scale a running installation.',
  },
  {
    label: 'Reference',
    id: 'reference/index',
    route: 'reference/',
    summary: 'Endpoints, configuration, commands, error codes and events, looked up by name.',
  },
  {
    label: 'Security',
    id: 'security/index',
    route: 'security/',
    summary: 'How Odudu protects credentials, sessions and tenants, and how to report a problem.',
  },
  {
    label: 'Contributing',
    id: 'contributing/index',
    route: 'contributing/',
    summary: 'Build Odudu from source, run its tests and send a change.',
  },
];

export interface Journey {
  readonly label: string;
  readonly route: string;
  readonly summary: string;
}

// The guides a new reader follows in order; the guides index and the home
// page list them as they are here.
export const JOURNEYS: readonly Journey[] = [
  {
    label: 'Sign a user in',
    route: 'guides/sign-a-user-in/',
    summary:
      'Send a person to Odudu and get tokens back, with the authorization code flow and PKCE.',
  },
  {
    label: 'Refresh and end a session',
    route: 'guides/refresh-and-end-a-session/',
    summary: 'Keep a person signed in, catch a stolen refresh token and sign them out.',
  },
  {
    label: 'An admin signs in and changes a user',
    route: 'guides/admin-signs-in-and-changes-a-user/',
    summary: 'Sign an administrator in to the console and make a safe change to a user.',
  },
  {
    label: 'Read a refusal',
    route: 'guides/read-a-refusal/',
    summary: 'What an error looks like, why it happened and what to do about it.',
  },
];

// The sections the home page lists once the reader has begun, in the order
// they are looked for.
export const START_ROUTES: readonly string[] = ['quick-start/', 'introduction/'];

export const NAVBAR_ROUTES: readonly string[] = [
  'quick-start/',
  'guides/',
  'concepts/',
  'reference/',
];

export const FOOTER_ROUTES: readonly string[] = [
  'quick-start/',
  'reference/',
  'security/',
  'contributing/',
];

export interface MachineReadableReference {
  readonly title: string;
  readonly description: string;
  // Where the build writes it, relative to the site root.
  readonly file: string;
}

// Files the build writes for tools rather than readers, such as an OpenAPI
// document; `llms.txt` lists each one and the build fails if its file is absent.
export const MACHINE_READABLE_REFERENCES: readonly MachineReadableReference[] = [
  {
    title: 'Admin API OpenAPI document',
    description: 'The OpenAPI 3.1 description of the admin API, as JSON.',
    file: 'openapi/admin.json',
  },
  {
    title: 'Me API OpenAPI document',
    description: 'The OpenAPI 3.1 description of the me API, as JSON.',
    file: 'openapi/me.json',
  },
];
