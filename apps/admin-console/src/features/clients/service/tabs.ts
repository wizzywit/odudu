import { clientHref } from '#/features/clients/service/address.ts';

// A client's record, a tab per concern, in the order the page shows them.
export const CLIENT_TABS = [
  'general',
  'redirects',
  'tokens',
  'scopes',
  'logout',
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
  return `${clientHref(tenant, id)}?tab=${tab}`;
}

export function clientRecord(id: string): string {
  return `clients/${id}`;
}

// Every tab edits the one record, so its dot follows the sections it holds.
export const TAB_SECTIONS: Readonly<Record<ClientTab, readonly string[]>> = {
  general: ['details', 'pages', 'availability', 'consent'],
  redirects: ['redirects', 'origins'],
  tokens: ['lifetimes', 'grants', 'credentials', 'fullScope', 'idToken'],
  scopes: [],
  logout: ['postLogout', 'backchannel', 'frontchannel'],
  advanced: ['auth', 'keys', 'userinfo', 'audiences', 'exchange'],
  roles: [],
  service: [],
  sessions: [],
  activity: [],
};

export function tabsWithEdits(dirty: ReadonlySet<string>): ReadonlySet<ClientTab> {
  return new Set(
    CLIENT_TABS.filter((tab) => TAB_SECTIONS[tab].some((section) => dirty.has(section))),
  );
}
