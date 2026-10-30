import { withSearch } from '#/shared/service/address';
import { TAB_PARAM } from '#/shared/service/record';
import { clientHref } from '#/features/clients/service/address';

// A client's record, a tab per concern, in the order the page shows them.
export const CLIENT_TABS = [
  'general',
  'redirects',
  'tokens',
  'scopes',
  'logout',
  'branding',
  'advanced',
  'roles',
  'service',
  'sessions',
  'activity',
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number];

export const CLIENT_TAB_LABELS: Readonly<Record<ClientTab, string>> = {
  general: 'General',
  redirects: 'Redirects & origins',
  tokens: 'Tokens',
  scopes: 'Scopes',
  logout: 'Logout',
  branding: 'Branding',
  advanced: 'Advanced',
  roles: 'Roles',
  service: 'Service account',
  sessions: 'Sessions',
  activity: 'Activity',
};

export function chosenTab(name: string): ClientTab | undefined {
  return CLIENT_TABS.find((tab) => tab === name);
}

export function clientTabHref(tenant: string, id: string, tab: ClientTab): string {
  return withSearch(clientHref(tenant, id), { [TAB_PARAM]: tab });
}

export function clientRecord(id: string): string {
  return `clients/${id}`;
}

// Every tab edits the one record, so its dot follows the sections it holds.
export const TAB_SECTIONS: Readonly<Record<ClientTab, readonly string[]>> = {
  general: ['details', 'translations', 'pages', 'availability', 'consent'],
  redirects: ['redirects', 'origins'],
  tokens: ['lifetimes', 'grants', 'credentials', 'fullScope', 'idToken'],
  scopes: [],
  logout: ['postLogout', 'confirmation', 'backchannel', 'frontchannel'],
  branding: [],
  advanced: ['auth', 'keys', 'userinfo', 'audiences', 'exchange'],
  roles: [],
  service: [],
  sessions: [],
  activity: [],
};

// The service account's roles are saved on its own record, so its dot is read from there.
export const SERVICE_SECTION = 'serviceRoles';

// The client's theme is saved on its own record, so its dot is read from there.
export function tabsWithEdits(
  dirty: ReadonlySet<string>,
  serviceDirty: ReadonlySet<string> = new Set(),
  brandingDirty: ReadonlySet<string> = new Set(),
): ReadonlySet<ClientTab> {
  return new Set(
    CLIENT_TABS.filter(
      (tab) =>
        TAB_SECTIONS[tab].some((section) => dirty.has(section)) ||
        (tab === 'service' && serviceDirty.has(SERVICE_SECTION)) ||
        (tab === 'branding' && brandingDirty.size > 0),
    ),
  );
}
