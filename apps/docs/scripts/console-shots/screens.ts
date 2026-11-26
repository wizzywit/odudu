import type { Page } from '@playwright/test';
import { BRANDING_SCREENS } from './screens-branding.ts';
import type { Context, Screen } from './screen.ts';

const DEMO = 'demo';
const CLIENT = 'my-app';
const REDIRECT = 'http://localhost:8080/callback';
const PERSON = 'ada';

async function exists(page: Page, cell: string): Promise<boolean> {
  await page.getByRole('heading', { level: 1 }).waitFor();
  const total = page.getByText(/^\d+ (client|clients|subject|subjects|tenant|tenants)$/u);
  await total.waitFor();
  const held = Number.parseInt((await total.innerText()).split(' ')[0] ?? '0', 10);
  // The count is drawn before the rows: a row not yet there is not a row absent.
  if (held > 0) await page.getByRole('row').nth(1).waitFor();
  return (await page.getByRole('row', { name: new RegExp(cell, 'u') }).count()) > 0;
}

async function openArea(page: Page, context: Context, area: string): Promise<void> {
  await page.goto(`${context.base}/console/${area}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
}

// The windows the sections are photographed in, each as tall as the sections it shows.
const TERMS_VIEW = { width: 1100, height: 1070 } as const;
const AUTHENTICATORS_VIEW = { width: 1100, height: 1040 } as const;
const PASSWORD_VIEW = { width: 1100, height: 890 } as const;
const ASSISTANT_VIEW = { width: 1100, height: 1180 } as const;

// Scrolled so the section's heading sits just under the strip of section links.
async function openSection(
  page: Page,
  context: Context,
  heading: string,
  tenant = DEMO,
): Promise<void> {
  await openArea(page, context, `${tenant}/settings`);
  const title = page.getByRole('heading', { level: 2, name: heading, exact: true });
  await title.waitFor();
  await title.evaluate((element) => {
    const top = element.closest('section')?.getBoundingClientRect().top ?? 0;
    window.scrollTo(0, window.scrollY + top - 72);
  });
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
    alt: "The demo tenant's Clients list: the built-in odudu-admin and odudu-mcp clients and my-app, with a Create a client button.",
    caption: 'The demo tenant lists my-app beside its two built-in clients.',
    signedIn: true,
    expect: [
      { heading: 'Clients' },
      { role: 'link', name: 'Create a client' },
      { rows: ['odudu-admin', 'odudu-mcp', CLIENT] },
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
    alt: "The demo tenant's Roles list: the thirteen built-in roles of the admin client, each marked as an admin capability, and a Create a role button.",
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
          'view-domains',
          'manage-domains',
          'use-assistant',
          'read-assistant-activity',
          'manage-assistant',
        ],
      },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/roles`);
      await page.getByText('13 roles').waitFor();
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
    name: 'client-actions',
    alt: "my-app's record on its Advanced tab, scrolled to Application actions: a checklist of the four credential changes the client may start for a signed-in person, none chosen, with the section's save control.",
    caption:
      'The credential changes a client may send a signed-in person to. None is chosen until an administrator chooses.',
    signedIn: true,
    expect: [
      { heading: CLIENT },
      { role: 'tab', name: 'Advanced' },
      { label: 'Register a passkey' },
    ],
    open: async (page, context) => {
      await openList(page, context, 'clients');
      await page.getByRole('row', { name: new RegExp(CLIENT, 'u') }).click();
      await page.getByRole('tab', { name: 'Advanced' }).click();
      const label = page.getByText('Actions an application may start', { exact: true });
      await label.waitFor();
      await label.evaluate((element) => {
        element.scrollIntoView({ block: 'center' });
      });
    },
  },
  {
    name: 'scopes',
    alt: "The demo tenant's Scopes list: openid, profile, email, address, phone, roles, groups, offline_access, mcp:read, mcp:write, me:read and me:write, with Restore built-in scopes and Create a scope buttons.",
    caption: 'The twelve scopes every tenant starts with.',
    signedIn: true,
    expect: [
      { heading: 'Scopes' },
      { role: 'link', name: 'Create a scope' },
      {
        rows: [
          'openid',
          'profile —',
          'email',
          'address',
          'phone',
          'roles',
          'groups',
          'offline_access',
          'mcp:read',
          'mcp:write',
          'me:read',
          'me:write',
        ],
      },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/scopes`);
      await page.getByText('12 scopes').waitFor();
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
    alt: 'The Sign-in flow page: four steps in order, passkey, password, otp and recovery-code, each with a requirement menu and a pair of chevron buttons that move it up or down, and the passkey, otp and recovery-code steps with a Settings group of their own, each starting at the tenant setting.',
    caption: 'The steps a person is asked, in order, each with its requirement.',
    signedIn: true,
    expect: [
      { heading: 'Sign-in flow' },
      { heading: 'Steps' },
      { label: 'Requirement for password' },
      { heading: 'Flows' },
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
    alt: "The demo tenant's Sessions page with a dimmed End every session button, a line saying there is no session to end, and a message that nobody is signed in.",
    caption: 'Nobody is signed in to the demo tenant.',
    signedIn: true,
    expect: [{ heading: 'Sessions' }, { role: 'button', name: 'End every session' }],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/sessions`);
      await page.getByText('No sessions yet').waitFor();
    },
  },
  {
    name: 'agents',
    alt: "The demo tenant's Agents page with an Approvals button, a State menu set to Any state, and a message saying no agent has acted in this tenant yet.",
    caption: 'No agent has acted in the demo tenant.',
    signedIn: true,
    expect: [{ heading: 'Agents' }, { role: 'link', name: 'Approvals' }, { label: 'State' }],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/agents`);
      await page.getByText('No agents yet').waitFor();
    },
  },
  {
    name: 'settings',
    alt: 'The Settings page: a strip of section links from General to Audit retention, then the General and Sessions sections, with the idle timeout shown as 30 and a unit menu set to min.',
    caption: 'Every section of the settings saves on its own.',
    signedIn: true,
    expect: [
      { heading: 'Settings' },
      { role: 'link', name: 'Password policy' },
      { role: 'link', name: 'Brute force' },
    ],
    open: (page, context) => openArea(page, context, `${DEMO}/settings`),
  },
  {
    name: 'settings-rail',
    alt: 'The Settings page on a wide screen: a rail of section links beside the sections, grouped under Tenant, Sign-in, Sessions and tokens, Applications and Records, with the section in view marked.',
    caption:
      'On a wide screen the list stays beside the sections, grouped, with the section in view marked.',
    signedIn: true,
    viewport: { width: 1500, height: 1000 },
    expect: [{ heading: 'Settings' }, { role: 'link', name: 'Passkey requirement' }],
    open: (page, context) => openArea(page, context, `${DEMO}/settings`),
  },
  {
    name: 'settings-profile',
    alt: 'The Terms and Profile sections of the Settings page. Terms has an address field and a short version field. Profile lists the twenty fields a person can edit under Name, On the web, About the person, Contact and Address, in columns.',
    caption: 'The Terms section, and the Profile section with its fields grouped.',
    signedIn: true,
    viewport: TERMS_VIEW,
    expect: [{ heading: 'Terms' }, { heading: 'Profile' }, { label: 'Terms address' }],
    open: (page, context) => openSection(page, context, 'Terms'),
  },
  {
    name: 'settings-authenticators',
    alt: 'The Authenticators and Passkey requirement sections of the Settings page. Authenticators has three groups: Authenticator app with algorithm, code length and code period, Passkeys, and Recovery codes. Passkey requirement is a single switch.',
    caption: 'Authenticators in three groups, and the passkey requirement in a section of its own.',
    signedIn: true,
    viewport: AUTHENTICATORS_VIEW,
    expect: [
      { heading: 'Authenticators' },
      { heading: 'Passkey requirement' },
      { label: 'Code length' },
    ],
    open: (page, context) => openSection(page, context, 'Authenticators'),
  },
  {
    name: 'settings-password',
    alt: 'The Password policy section of the Settings page, in four groups: Length and complexity, Must not contain, Reuse and age, and Breached passwords, where the setting for a failed remote lookup is dimmed because the check is not set to the remote lookup.',
    caption:
      'The password policy in groups; the remote lookup setting waits for the remote lookup.',
    signedIn: true,
    viewport: PASSWORD_VIEW,
    expect: [{ heading: 'Password policy' }, { label: 'Check against known breaches' }],
    open: (page, context) => openSection(page, context, 'Password policy'),
  },
  {
    name: 'settings-assistant',
    alt: 'The Console assistant section of the Settings page, in three groups: Availability with a switch for offering the assistant and the mode it starts in, Privacy and records with email masking, auditor access and trace retention, and Limits with the monthly tokens of each model slot, the answers at once and the steps in one answer. Each setting says its default.',
    caption: 'The assistant’s settings, each with its default beside it.',
    signedIn: true,
    viewport: ASSISTANT_VIEW,
    expect: [{ heading: 'Console assistant' }, { label: 'Offer the assistant' }],
    open: (page, context) => openSection(page, context, 'Console assistant', 'system'),
  },
  {
    name: 'settings-assistant-phone',
    alt: 'The Console assistant section of the Settings page on a phone: the same groups in a single column, with each setting’s switch or field above its default and range.',
    caption: 'On a narrow screen the assistant’s settings stack in one column.',
    signedIn: true,
    viewport: { width: 390, height: 1500 },
    expect: [{ heading: 'Console assistant' }, { label: 'Offer the assistant' }],
    open: (page, context) => openSection(page, context, 'Console assistant', 'system'),
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
    name: 'domains',
    alt: 'The Domains page: a Register a domain form with a Host field and a Register domain button, an empty list saying the tenant signs in at its path address, and a Switching the address note.',
    caption: 'A tenant with no domain signs in at its path address.',
    signedIn: true,
    expect: [
      { heading: 'Domains' },
      { heading: 'Register a domain' },
      { label: 'Host' },
      { role: 'button', name: 'Register domain' },
    ],
    open: async (page, context) => {
      await openArea(page, context, `${DEMO}/domains`);
      await page.getByText('No domains').waitFor();
    },
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
