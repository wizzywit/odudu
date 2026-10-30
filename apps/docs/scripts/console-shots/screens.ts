import type { Page } from '@playwright/test';
import { BRANDING_SCREENS } from './screens-branding.ts';
import type { Context, Screen } from './screen.ts';

const DEMO = 'demo';
const CLIENT = 'my-app';
const REDIRECT = 'http://localhost:8080/callback';
const PERSON = 'ada';

async function exists(page: Page, cell: string): Promise<boolean> {
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByText(/^\d+ (client|clients|subject|subjects|tenant|tenants)$/u).waitFor();
  return (await page.getByRole('row', { name: new RegExp(cell, 'u') }).count()) > 0;
}

async function openArea(page: Page, context: Context, area: string): Promise<void> {
  await page.goto(`${context.base}/console/${area}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
}

async function openList(page: Page, context: Context, area: string): Promise<void> {
  await page.goto(`${context.base}/console/${DEMO}/${area}`);
}

export const SCREENS: readonly Screen[] = [
  {
    name: 'sign-in-tenant',
    alt: 'The console asks which tenant you administer, with one field and a Continue to sign-in button.',
    caption: 'The console first asks which tenant you administer.',
    signedIn: false,
    expect: [{ heading: 'Sign in' }, { role: 'button', name: 'Continue to sign-in' }],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/`);
      await page.getByLabel(/tenant/iu).fill('system');
    },
  },
  {
    name: 'sign-in',
    alt: "Odudu's sign-in page for the system tenant, with Username and Password fields.",
    caption: "Odudu's own sign-in page, with the administrator's email as the username.",
    signedIn: false,
    expect: [{ heading: 'Sign in' }, { label: 'Username' }, { label: 'Password' }],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/`);
      await page.getByLabel(/tenant/iu).fill('system');
      await page.getByRole('button', { name: 'Continue to sign-in' }).click();
      await page.getByLabel('Username').waitFor();
    },
  },
  {
    name: 'new-tenant',
    alt: 'The Create a tenant form with the name demo typed in and its issuer, http://localhost:3000/tenants/demo, shown beneath.',
    caption: 'A tenant needs only a name. The issuer follows from it.',
    signedIn: true,
    expect: [
      { heading: 'Create a tenant' },
      { label: 'Name' },
      { role: 'button', name: 'Create tenant' },
    ],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/system/new-tenant`);
      await page.getByLabel('Name', { exact: true }).fill(DEMO);
      await page.getByText(`/tenants/${DEMO}`).waitFor();
    },
    leave: async (page, context) => {
      await page.goto(`${context.base}/console/system/tenants`);
      if (await exists(page, `^${DEMO}`)) return;
      await page.goto(`${context.base}/console/system/new-tenant`);
      await page.getByLabel('Name', { exact: true }).fill(DEMO);
      await page.getByRole('button', { name: 'Create tenant' }).click();
      await page.getByText(`${DEMO} was created`).waitFor();
    },
  },
  {
    name: 'new-client',
    alt: 'The Create a client form with client ID my-app, the kind Public application and one redirect URI.',
    caption: 'A public client, with the address Odudu sends the browser back to.',
    signedIn: true,
    expect: [
      { heading: 'Create a client' },
      { label: 'Client ID' },
      { role: 'button', name: 'Create client' },
    ],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/${DEMO}/clients/new`);
      await page.getByLabel('Client ID').fill(CLIENT);
      await page.getByLabel('Kind').click();
      await page.getByRole('option', { name: 'Public application' }).click();
      await page.getByRole('textbox', { name: 'Redirect URI' }).first().fill(REDIRECT);
    },
    leave: async (page, context) => {
      await openList(page, context, 'clients');
      if (await exists(page, CLIENT)) return;
      await page.goto(`${context.base}/console/${DEMO}/clients/new`);
      await page.getByLabel('Client ID').fill(CLIENT);
      await page.getByLabel('Kind').click();
      await page.getByRole('option', { name: 'Public application' }).click();
      await page.getByRole('textbox', { name: 'Redirect URI' }).first().fill(REDIRECT);
      await page.getByRole('button', { name: 'Create client' }).click();
      await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor();
    },
  },
  {
    name: 'clients',
    alt: "The demo tenant's Clients list: the built-in odudu-admin client and my-app, with a Create a client button.",
    caption: 'The demo tenant lists my-app beside its built-in administration client.',
    signedIn: true,
    expect: [
      { heading: 'Clients' },
      { role: 'link', name: 'Create a client' },
      { rows: ['odudu-admin', CLIENT] },
    ],
    open: (page, context) => openList(page, context, 'clients'),
  },
  {
    name: 'new-subject',
    alt: 'The Create a subject form with the username ada typed in.',
    caption: 'A person needs only a username. There is no password field.',
    signedIn: true,
    expect: [
      { heading: 'Create a subject' },
      { label: 'Username' },
      { role: 'button', name: 'Create subject' },
    ],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/${DEMO}/subjects/new`);
      await page.getByLabel('Username').fill(PERSON);
    },
    leave: async (page, context) => {
      await openList(page, context, 'subjects');
      if (await exists(page, PERSON)) return;
      await page.goto(`${context.base}/console/${DEMO}/subjects/new`);
      await page.getByLabel('Username').fill(PERSON);
      await page.getByRole('button', { name: 'Create subject' }).click();
      await page.getByRole('heading', { level: 1, name: PERSON }).waitFor();
    },
  },
  {
    name: 'subjects',
    alt: "The demo tenant's Subjects list, with the person ada and a Create a subject button.",
    caption: 'The demo tenant now lists the person.',
    signedIn: true,
    expect: [
      { heading: 'Subjects' },
      { role: 'link', name: 'Create a subject' },
      { rows: [PERSON] },
    ],
    open: (page, context) => openList(page, context, 'subjects'),
  },
  {
    name: 'issue-password',
    alt: 'The Credentials tab of ada, with a dialog asking whether to issue a one-time password.',
    caption:
      'The console issues a one-time password. It is shown once, and the person changes it at first sign-in.',
    signedIn: true,
    expect: [{ heading: PERSON }, { role: 'button', name: 'Issue password' }],
    open: async (page, context) => {
      await openList(page, context, 'subjects');
      await page.getByRole('row', { name: new RegExp(PERSON, 'u') }).click();
      await page.getByRole('tab', { name: 'Credentials' }).click();
      await page.getByRole('button', { name: 'Issue a one-time password' }).click();
    },
    leave: async (page) => {
      await page.getByRole('button', { name: 'Cancel' }).click();
    },
  },
  {
    name: 'overview',
    alt: "The demo tenant's Overview: nothing needs attention, the counts of its subjects, clients, groups, roles and scopes, and its discovery addresses, with the console's menu on the left.",
    caption: 'A tenant opens on its Overview: what needs attention, the counts and its addresses.',
    signedIn: true,
    expect: [{ heading: 'Overview' }, { heading: 'Needs attention' }, { heading: 'Counts' }],
    open: async (page, context) => {
      await openArea(page, context, DEMO);
      await page.getByText(/^\d+ subjects?$/u).waitFor();
    },
  },
  {
    name: 'subject-profile',
    alt: "ada's record on its Profile tab, with the tabs Profile, Credentials, Groups, Roles, Required actions, Sessions, Consents and Grants above the account fields.",
    caption: 'A person opens on a Profile tab. The Activity tab is just beyond the right edge.',
    signedIn: true,
    expect: [
      { heading: PERSON },
      { role: 'tab', name: 'Profile' },
      { role: 'tab', name: 'Credentials' },
      { role: 'tab', name: 'Activity' },
    ],
    open: async (page, context) => {
      await openList(page, context, 'subjects');
      await page.getByRole('row', { name: new RegExp(PERSON, 'u') }).click();
      await page.getByRole('tab', { name: 'Profile' }).waitFor();
    },
  },
  {
    name: 'groups',
    alt: "The demo tenant's Groups list, empty, with a Create a group button and a search by name.",
    caption: 'No group exists yet in the demo tenant.',
    signedIn: true,
    expect: [{ heading: 'Groups' }, { role: 'link', name: 'Create a group' }],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/groups`);
      await page.getByText('No groups yet').waitFor();
    },
  },
  {
    name: 'new-group',
    alt: 'The Create a group form with the name engineering typed in and a parent picker beneath it.',
    caption: 'A group needs a name. It can sit under a parent.',
    signedIn: true,
    expect: [
      { heading: 'Create a group' },
      { label: 'Name' },
      { role: 'button', name: 'Create group' },
    ],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/${DEMO}/groups/new`);
      await page.getByLabel('Name', { exact: true }).fill('engineering');
    },
  },
  {
    name: 'roles',
    alt: "The demo tenant's Roles list: the eight built-in admin capabilities, each marked as an admin capability, and a Create a role button.",
    caption: 'Every tenant starts with the admin capabilities as roles.',
    signedIn: true,
    expect: [
      { heading: 'Roles' },
      { role: 'link', name: 'Create a role' },
      {
        rows: [
          'tenant-admin',
          'view-users',
          'manage-users',
          'manage-clients',
          'manage-tenant',
          'manage-keys',
          'manage-sessions',
          'view-audit',
        ],
      },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/roles`);
      await page.getByText('8 roles').waitFor();
    },
  },
  {
    name: 'client-redirects',
    alt: "my-app's record on its Redirects & origins tab, listing its one redirect URI and the buttons to add another redirect URI or a web origin. The tab row runs past the right edge.",
    caption:
      'The redirect URIs a client may send the browser back to, and the web origins it may be called from.',
    signedIn: true,
    expect: [
      { heading: CLIENT },
      { role: 'tab', name: 'Redirects & origins' },
      { role: 'button', name: 'Add redirect URI' },
    ],
    open: async (page, context) => {
      await openList(page, context, 'clients');
      await page.getByRole('row', { name: new RegExp(CLIENT, 'u') }).click();
      await page.getByRole('tab', { name: 'Redirects & origins' }).click();
      await page.getByRole('button', { name: 'Add redirect URI' }).waitFor();
    },
  },
  {
    name: 'scopes',
    alt: "The demo tenant's Scopes list: openid, profile, email, address, phone, roles, groups and offline_access, with Restore built-in scopes and Create a scope buttons.",
    caption: 'The eight scopes every tenant starts with.',
    signedIn: true,
    expect: [
      { heading: 'Scopes' },
      { role: 'link', name: 'Create a scope' },
      {
        rows: [
          'openid',
          'profile',
          'email',
          'address',
          'phone',
          'roles',
          'groups',
          'offline_access',
        ],
      },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/scopes`);
      await page.getByText('8 scopes').waitFor();
    },
  },
  {
    name: 'registration-tokens',
    alt: 'The Registration tokens page with the Mint a registration token form, its Uses and Lifetime fields and a Mint token button, above an empty list.',
    caption: 'No registration token is live. A token is minted from this form.',
    signedIn: true,
    expect: [
      { heading: 'Registration tokens' },
      { label: 'Uses' },
      { label: 'Lifetime' },
      { role: 'button', name: 'Mint token' },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/registration-tokens`);
      await page.getByText('No registration tokens yet').waitFor();
    },
  },
  {
    name: 'flow',
    alt: 'The Sign-in flow page: four steps in order, passkey, password, otp and recovery-code, each with a requirement menu and Up and Down buttons.',
    caption: 'The steps a person is asked, in order, each with its requirement.',
    signedIn: true,
    expect: [
      { heading: 'Sign-in flow' },
      { heading: 'Steps' },
      { label: 'Requirement for password' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/flow`),
  },
  {
    name: 'signing-keys',
    alt: 'The Signing keys page: a Stage a key form with an algorithm menu and a Stage key button, an empty Rotating lane, and the Active lane with one ES256 key that cannot be retired while it is active.',
    caption: 'A new key is staged here and waits in Rotating until it is promoted.',
    signedIn: true,
    expect: [
      { heading: 'Signing keys' },
      { heading: 'Active' },
      { role: 'button', name: 'Stage key' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/keys`),
  },
  {
    name: 'tenant-sessions',
    alt: "The demo tenant's Sessions page with an End every session button and a message that nobody is signed in.",
    caption: 'Nobody is signed in to the demo tenant.',
    signedIn: true,
    expect: [{ heading: 'Sessions' }, { role: 'button', name: 'End every session' }],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/sessions`);
      await page.getByText('No sessions yet').waitFor();
    },
  },
  {
    name: 'settings',
    alt: 'The Settings page: a row of section names from General to Audit retention, then the General and Sessions sections with their fields.',
    caption: 'Every section of the settings saves on its own.',
    signedIn: true,
    expect: [
      { heading: 'Settings' },
      { role: 'button', name: 'Password policy' },
      { role: 'button', name: 'Brute force' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/settings`),
  },
  {
    name: 'email',
    alt: 'The Email page: a notice that nothing sends this tenant’s mail, and the Mail relay form with Host, Port and Sender address.',
    caption:
      'Until a relay is saved, verification and reset mail is only written to the server’s log.',
    signedIn: true,
    expect: [
      { heading: 'Email' },
      { heading: 'Mail relay' },
      { label: 'Host' },
      { role: 'button', name: 'Send test message' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/email`),
  },
  {
    name: 'audit',
    alt: "The demo tenant's audit trail: the three events so far, tenant.create, client.create and subject.create, each allowed and made by a system administrator.",
    caption: 'The trail records each change with who made it, newest first.',
    signedIn: true,
    expect: [
      { heading: 'Audit trail' },
      { role: 'button', name: 'Apply filters' },
      { rows: ['tenant.create', 'client.create', 'subject.create'] },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/audit`);
      await page.getByText('subject.create').evaluate((cell) => {
        cell.scrollIntoView({ block: 'center' });
      });
    },
  },
  {
    name: 'tenants',
    alt: 'The Tenants list of the system tenant: system and demo, each with an Enter button, and the Import a tenant and Create a tenant buttons.',
    caption: 'The system tenant lists every tenant, with a way into each.',
    signedIn: true,
    expect: [
      { heading: 'Tenants' },
      { role: 'link', name: 'Create a tenant' },
      { role: 'link', name: 'Import a tenant' },
      { rows: ['system', DEMO] },
    ],
    open: async (page, context) => {
      await page.goto(`${context.base}/console/system/tenants`);
      await page.getByText(/^\d+ tenants?$/u).waitFor();
    },
  },
  {
    name: 'export',
    alt: 'The Export page for demo, with an Include subjects switch and an Export to a file button.',
    caption: 'An export is a file of the tenant’s configuration. No secret is in it.',
    signedIn: true,
    expect: [
      { heading: 'Export demo' },
      { label: 'Include subjects' },
      { role: 'button', name: 'Export to a file' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/export`),
  },
  {
    name: 'system-admins',
    alt: 'The System administrators page: one administrator, admin@odudu.local, holding Full (tenant-admin) and reaching every tenant.',
    caption: 'The first administrator holds every capability and reaches every tenant.',
    signedIn: true,
    expect: [
      { heading: 'System administrators' },
      { role: 'button', name: 'Give it to the chosen subject' },
    ],
    open: async (page, context) => {
      await openArea(page, context, 'system/system-admins');
      await page.getByText('1 administrator').waitFor();
    },
  },
  ...BRANDING_SCREENS,
];
