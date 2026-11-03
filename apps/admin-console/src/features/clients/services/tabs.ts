import { recordTabs } from '#/shared/services/record';

// A client's record, a tab per concern, in the order the page shows them.
const TABS = [
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

export type ClientTab = (typeof TABS)[number];

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

const model = recordTabs({
  tabs: TABS,
  labels: {
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
  },
  sections: TAB_SECTIONS,
});

export const CLIENT_TABS = model.tabs;
export const CLIENT_TAB_LABELS = model.labels;
export const chosenTab = model.named;
export const clientTabHrefOf = model.hrefOf;

export function clientRecord(id: string): string {
  return `clients/${id}`;
}

// The service account's roles are saved on its own record, so its dot is read from there.
export const SERVICE_SECTION = 'serviceRoles';

// The client's theme is saved on its own record, so its dot is read from there.
export function tabsWithEdits(
  dirty: ReadonlySet<string>,
  serviceDirty: ReadonlySet<string> = new Set(),
  brandingDirty: ReadonlySet<string> = new Set(),
): ReadonlySet<ClientTab> {
  return model.edited(
    (tab) =>
      model.holds(tab, dirty) ||
      (tab === 'service' && serviceDirty.has(SERVICE_SECTION)) ||
      (tab === 'branding' && brandingDirty.size > 0),
  );
}
