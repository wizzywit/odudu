// Where each bold name on a console page is defined: the files that render
// that control and the text there that gives the name. A name that means
// something in more than one place (a tab, a menu entry, a section) lists each
// place a page uses it. A name built from a template (`Create ${noun}`) lists
// the template and the file that binds each part, and the test expands it. A
// name a page quotes that is not here fails, so a new quotation is a new row,
// read against its screen.
export interface Evidence {
  readonly file: string;
  readonly text: string;
}

export interface Defined {
  readonly evidence: readonly Evidence[];
  // For a template: the values its parts take, which must expand to the name.
  readonly expand?: {
    readonly template: string;
    readonly values: Readonly<Record<string, string>>;
  };
}

const FEATURES = 'apps/admin-console/src/features';
const PAGES = 'apps/admin-console/src/pages';
const ENTITIES = 'apps/admin-console/src/entities';
const SHARED = 'apps/admin-console/src/shared';
const MESSAGES = 'packages/protocol-oidc/src/view/messages.ts';

const at = (file: string, ...texts: readonly string[]): Defined => ({
  evidence: texts.map((text) => ({ file, text })),
});

const several = (...parts: readonly Defined[]): Defined => ({
  evidence: parts.flatMap((part) => part.evidence),
});

const feature = (path: string, ...texts: readonly string[]): Defined =>
  at(`${FEATURES}/${path}`, ...texts);
const page = (path: string, ...texts: readonly string[]): Defined =>
  at(`${PAGES}/${path}`, ...texts);
const entity = (path: string, ...texts: readonly string[]): Defined =>
  at(`${ENTITIES}/${path}`, ...texts);
const shared = (path: string, ...texts: readonly string[]): Defined =>
  at(`${SHARED}/${path}`, ...texts);

function template(
  parts: readonly Evidence[],
  pattern: string,
  values: Readonly<Record<string, string>>,
): Defined {
  return { evidence: parts, expand: { template: pattern, values } };
}

const inFeature = (path: string, text: string): Evidence => ({
  file: `${FEATURES}/${path}`,
  text,
});
const inPage = (path: string, text: string): Evidence => ({
  file: `${PAGES}/${path}`,
  text,
});

// The menu entry of an area, whose label areas.ts gives beside its path.
const AREAS = 'apps/admin-console/src/entities/area/services/areas.ts';
const rail = (path: string, label: string): Defined => at(AREAS, `area('${path}', '${label}'`);
const heading = (label: string): Defined => at(AREAS, `heading: '${label}'`);

const tab = (feature_: string, key: string, label: string): Defined =>
  feature(`${feature_}/services/tabs.ts`, `${key}: '${label}'`);
const pageTab = (page_: string, key: string, label: string): Defined =>
  page(`${page_}/services/tabs.ts`, `${key}: '${label}'`);
const subjectTab = (key: string, label: string): Defined => pageTab('subjects', key, label);
const clientTab = (key: string, label: string): Defined => pageTab('clients', key, label);

const FILTERS = 'audit/services/filterWords.ts';
const AUDIT_KINDS = 'audit/services/filterOptions.ts';
const EMAIL_PAGE = 'email/ui/EmailPage/EmailPage.tsx';
const EMAIL_RELAY = 'email/services/relay.ts';
const EMAIL_MAIL = 'email/services/mail.ts';
const ACCESS = 'settings/services/accessSections.ts';
const PLATFORM = 'settings/services/platformSections.ts';
const KEYS_PAGE = 'signing-keys/ui/SigningKeysPage/SigningKeysPage.tsx';
const KEYS_CONFIRM = 'signing-keys/services/confirm.ts';
const TOKENS_PAGE = 'registration-tokens/ui/RegistrationTokensPage/RegistrationTokensPage.tsx';
const FLOW_REQUIREMENTS = 'flow/services/requirements.ts';
const SCOPE_GENERAL = 'scopes/ui/ScopeRecordPage/GeneralTab.tsx';
const SCOPE_DELIVERY = 'scopes/services/scopeDelivery.ts';
const CLIENT_NEW = 'clients/ui/NewClientPage/NewClientPage.tsx';
const TENANT_NEW = 'tenants/ui/NewTenantPage/NewTenantPage.tsx';
const TENANT_IMPORT = 'tenants/ui/ImportTenantPage/ImportTenantPage.tsx';
const SYSTEM_PAGE = 'system-admins/ui/SystemAdministratorsPage/SystemAdministratorsPage.tsx';
const SUBJECT_PROFILE = 'subjects/ui/SubjectRecordPage/ProfileTab.tsx';
const CREATION_FORM = `${SHARED}/ui/CreationForm/CreationForm.tsx`;
const DELETE_ZONE = `${SHARED}/ui/DeleteZone/DeleteZone.tsx`;

const createWith = (
  noun: string,
  file: string,
  evidenceIn: (path: string, text: string) => Evidence = inFeature,
): Defined =>
  template(
    [{ file: CREATION_FORM, text: '`Create ${noun}`' }, evidenceIn(file, `noun="${noun}"`)],
    'Create ${noun}',
    { noun },
  );

const deleteNamed = (
  page: string,
  subject: string,
  evidenceIn: (path: string, text: string) => Evidence = inFeature,
): Defined =>
  template(
    [{ file: DELETE_ZONE, text: '`Delete ${name}`' }, evidenceIn(page, '<DeleteZone')],
    'Delete ${name}',
    { name: subject },
  );

export const DEFINED: Readonly<Record<string, Defined>> = {
  // Sign-in, as the console and Odudu's own page word it.
  'Continue to sign-in': at(
    'apps/admin-console/src/widgets/session-gate/services/signInText.ts',
    "return 'Continue to sign-in'",
  ),
  Username: several(
    at(MESSAGES, "'login.username': 'Username'"),
    page('subjects/ui/NewSubjectPage/NewSubjectPage.tsx', 'label="Username"'),
    page(TENANT_NEW, 'label="Username"'),
    feature(EMAIL_RELAY, "username: 'Username'"),
    feature('subject-capabilities/ui/CapabilityHolders/CapabilityHolders.tsx', "label: 'Username'"),
  ),
  Password: at(MESSAGES, "'login.password': 'Password'"),
  'Sign out': at('apps/admin-console/src/widgets/shell/ui/RailFooter/RailFooter.tsx', 'Sign out'),
  // The panel a failed page is replaced by.
  'Something went wrong': feature(
    'failure/services/wording.ts',
    "FAILURE_TITLE = 'Something went wrong'",
  ),
  'Try again': feature('failure/services/wording.ts', "TRY_AGAIN_LABEL = 'Try again'"),
  'Back to overview': feature(
    'failure/services/wording.ts',
    "BACK_TO_OVERVIEW_LABEL = 'Back to overview'",
  ),
  'Reload the console': feature(
    'failure/services/wording.ts',
    "RELOAD_LABEL = 'Reload the console'",
  ),
  'Error ID': feature('failure/services/report.ts', '`Error ID: ${report.id}`'),
  Copy: shared('ui/CopyValue/CopyValue.tsx', 'Copy'),
  'Keep mine': shared('ui/ConflictPanel/ConflictPanel.tsx', 'Keep mine'),
  'Take theirs': shared('ui/ConflictPanel/ConflictPanel.tsx', 'Take theirs'),
  'Back to system': shared('ui/ContextBar/ContextBar.tsx', 'Back to system'),

  // The menu: its headings and its entries.
  SYSTEM: heading('System'),
  IDENTITY: heading('Identity'),
  APPLICATIONS: heading('Applications'),
  SECURITY: heading('Security'),
  TENANT: heading('Tenant'),
  OBSERVE: heading('Observe'),
  Overview: several(
    at(AREAS, "area('', 'Overview'"),
    feature('overview/ui/OverviewPage/OverviewPage.tsx', 'title="Overview"'),
  ),
  Subjects: rail('subjects', 'Subjects'),
  Groups: several(rail('groups', 'Groups'), subjectTab('groups', 'Groups')),
  Roles: several(
    rail('roles', 'Roles'),
    subjectTab('roles', 'Roles'),
    pageTab('groups', 'roles', 'Roles'),
    pageTab('scopes', 'roles', 'Roles'),
    clientTab('roles', 'Roles'),
  ),
  Clients: several(rail('clients', 'Clients'), pageTab('scopes', 'clients', 'Clients')),
  Scopes: several(rail('scopes', 'Scopes'), clientTab('scopes', 'Scopes')),
  'Registration tokens': rail('registration-tokens', 'Registration tokens'),
  'Sign-in flow': rail('flow', 'Sign-in flow'),
  'Signing keys': rail('keys', 'Signing keys'),
  Sessions: several(
    rail('sessions', 'Sessions'),
    subjectTab('sessions', 'Sessions'),
    clientTab('sessions', 'Sessions'),
    feature(ACCESS, "title: 'Sessions'"),
  ),
  Settings: rail('settings', 'Settings'),
  Branding: rail('branding', 'Branding'),
  Email: several(
    rail('email', 'Email'),
    page('subjects/ui/NewSubjectPage/NewSubjectPage.tsx', 'label="Email"'),
    page(TENANT_NEW, 'label="Email"'),
  ),
  Export: several(
    rail('export', 'Export'),
    page('tenants/ui/TenantRecordPage/TenantRecordPage.tsx', "'Export'"),
  ),
  'Audit trail': rail('audit', 'Audit trail'),
  Tenants: rail('tenants', 'Tenants'),
  'System administrators': rail('system-admins', 'System administrators'),

  // Tabs of a record.
  Profile: subjectTab('profile', 'Profile'),
  Credentials: subjectTab('credentials', 'Credentials'),
  'Required actions': page('subjects/services/tabs.ts', "'required-actions': 'Required actions'"),
  Consents: subjectTab('consents', 'Consents'),
  Grants: subjectTab('grants', 'Grants'),
  Activity: several(
    subjectTab('activity', 'Activity'),
    clientTab('activity', 'Activity'),
    pageTab('groups', 'activity', 'Activity'),
    pageTab('roles', 'activity', 'Activity'),
    pageTab('scopes', 'activity', 'Activity'),
  ),
  General: several(
    clientTab('general', 'General'),
    pageTab('groups', 'general', 'General'),
    pageTab('roles', 'general', 'General'),
    pageTab('scopes', 'general', 'General'),
    page('tenants/ui/GeneralTab/GeneralTab.tsx', 'title="General"'),
    feature(ACCESS, "title: 'General'"),
  ),
  'Redirects & origins': clientTab('redirects', 'Redirects & origins'),
  Tokens: clientTab('tokens', 'Tokens'),
  Logout: clientTab('logout', 'Logout'),
  Advanced: clientTab('advanced', 'Advanced'),
  'Service account': clientTab('service', 'Service account'),
  Members: several(pageTab('groups', 'members', 'Members'), pageTab('roles', 'members', 'Members')),
  Composites: pageTab('roles', 'composites', 'Composites'),
  'Claim mappers': pageTab('scopes', 'mappers', 'Claim mappers'),
  Administrators: page('tenants/ui/TenantRecordPage/TenantRecordPage.tsx', "'Administrators'"),

  // Creating things.
  'Create a tenant': page('tenants/ui/TenantsPage/TenantsPage.tsx', '> Create a tenant <'),
  'Create a client': page('clients/ui/ClientsPage/ClientsPage.tsx', '> Create a client <'),
  'Create a subject': page('subjects/ui/SubjectsPage/SubjectsPage.tsx', '> Create a subject <'),
  'Create a group': page('groups/ui/GroupsPage/GroupsPage.tsx', '> Create a group <'),
  'Create a role': page('roles/ui/RolesPage/RolesPage.tsx', '> Create a role <'),
  'Create a scope': page('scopes/ui/ScopesPage/ScopesPage.tsx', '> Create a scope <'),
  'Restore built-in scopes': page(
    'scopes/ui/ScopesPage/RestoreScopes.tsx',
    '>Restore built-in scopes<',
  ),
  Restore: page('scopes/services/restore.ts', "RESTORE_CONFIRM_LABEL = 'Restore'"),
  'Include all roles in tokens': page(
    'clients/services/idTokenPolicy.ts',
    "FULL_SCOPE_LABEL = 'Include all roles in tokens'",
  ),
  'Used because nothing is bound': page(
    'scopes/services/mappers.ts',
    "DEFAULT_MAPPER_NOTE = 'Used because nothing is bound'",
  ),
  'Create a copy': page('roles/ui/RoleRecordPage/RoleRecordPage.tsx', '> Create a copy <'),
  'Import a tenant': several(
    page('tenants/ui/TenantsPage/TenantsPage.tsx', '>Import a tenant<'),
    page('tenants/services/creationPosition.ts', "IMPORT_TITLE = 'Import a tenant'"),
  ),
  'Create tenant': page(TENANT_NEW, "'Create tenant'"),
  'Create client': createWith('client', CLIENT_NEW, inPage),
  'Create subject': createWith('subject', 'subjects/ui/NewSubjectPage/NewSubjectPage.tsx', inPage),
  'Create group': createWith('group', 'groups/ui/NewGroupPage/NewGroupPage.tsx', inPage),
  'Create role': createWith('role', 'roles/ui/NewRolePage/NewRolePage.tsx', inPage),
  'Create scope': createWith('scope', 'scopes/ui/NewScopePage/NewScopePage.tsx', inPage),
  'Create administrator': page(TENANT_NEW, "'Create administrator'"),
  'Create a new subject as an administrator': page(
    SYSTEM_PAGE,
    '>Create a new subject as an administrator<',
  ),
  Name: several(
    page(TENANT_NEW, 'label="Name"'),
    page(TENANT_IMPORT, 'label="Name"'),
    page(CLIENT_NEW, 'label="Name"'),
    at(CREATION_FORM, 'label="Name"'),
  ),
  'Display name': several(
    page(TENANT_NEW, 'label="Display name"'),
    page(TENANT_IMPORT, 'label="Display name"'),
    page('tenants/use-cases/useTenantGeneral.ts', "label: 'Display name'"),
  ),
  Description: several(
    at(CREATION_FORM, 'label="Description"'),
    page(CLIENT_NEW, 'label="Description"'),
  ),
  'Client ID': page(CLIENT_NEW, 'label="Client ID"'),
  Kind: page(CLIENT_NEW, 'label="Kind"'),
  'Web application': page('clients/services/newClient.ts', "label: 'Web application'"),
  Service: page('clients/services/newClient.ts', "label: 'Service'"),
  'Public application': page('clients/services/newClient.ts', "label: 'Public application'"),
  'Redirect URIs': several(
    page(CLIENT_NEW, 'label="Redirect URIs"'),
    page('clients/ui/RedirectsTab/RedirectsTab.tsx', 'label="Redirect URIs"'),
  ),
  'Post-logout redirect URIs': page(
    'clients/ui/LogoutTab/LogoutTab.tsx',
    'label="Post-logout redirect URIs"',
  ),
  Parent: page('groups/ui/NewGroupPage/NewGroupPage.tsx', 'label="Parent"'),
  'Enter demo': template(
    [inPage('tenants/ui/TenantsPage/TenantsPage.tsx', '`Enter ${tenant.name}`')],
    'Enter ${tenant.name}',
    { 'tenant.name': 'demo' },
  ),
  'Open demo': template([inPage(TENANT_NEW, '`Open ${step.tenant}`')], 'Open ${step.tenant}', {
    'step.tenant': 'demo',
  }),

  // Finding things in a list.
  Capability: page('subjects/ui/SubjectsPage/SubjectsPage.tsx', 'label="Capability"'),
  Status: several(
    page('subjects/ui/SubjectsPage/SubjectsPage.tsx', 'label="Status"'),
    page('tenants/ui/TenantsPage/TenantsPage.tsx', 'label="Status"'),
    feature('subject-capabilities/ui/CapabilityHolders/CapabilityHolders.tsx', 'label="Status"'),
  ),
  Holds: feature(
    'subject-capabilities/ui/CapabilityHolders/CapabilityHolders.tsx',
    'label="Holds"',
  ),
  'Belongs to': page('roles/ui/RolesPage/RolesPage.tsx', 'label="Belongs to"'),
  Previous: shared('ui/Pager/Pager.tsx', 'Previous'),
  Next: shared('ui/Pager/Pager.tsx', 'Next'),

  // Subjects.
  'Issue a one-time password': page(
    'subjects/ui/SubjectRecordPage/CredentialsTab.tsx',
    'Issue a one-time password',
  ),
  'Issue password': page('subjects/services/credentialAsk.ts', "confirmLabel: 'Issue password'"),
  'Send a password reset email': page(
    'subjects/ui/SubjectRecordPage/CredentialsTab.tsx',
    '> Send a password reset email <',
  ),
  'Revoke recovery codes': page(
    'subjects/services/credentialAsk.ts',
    "confirmLabel: 'Revoke recovery codes'",
  ),
  'Revoke grants': page(
    'subjects/ui/SubjectRecordPage/GrantsTab.tsx',
    'confirmLabel="Revoke grants"',
  ),
  'End session': page(
    'subjects/ui/SubjectRecordPage/SessionsTab.tsx',
    'confirmLabel="End session"',
  ),
  'End every session': several(
    page('subjects/ui/SubjectRecordPage/SessionsTab.tsx', 'confirmLabel="End every session"'),
    page(
      'tenant-sessions/ui/TenantSessionsPage/TenantSessionsPage.tsx',
      'confirmLabel="End every session"',
    ),
  ),
  'Admin capabilities': feature(
    'subject-capabilities/ui/CapabilityEditor/CapabilityEditor.tsx',
    'title="Admin capabilities"',
  ),
  'Disable ada': template([inPage(SUBJECT_PROFILE, '`Disable ${name}`')], 'Disable ${name}', {
    name: 'ada',
  }),
  'Delete ada': template([inPage(SUBJECT_PROFILE, '`Delete ${name}`')], 'Delete ${name}', {
    name: 'ada',
  }),
  Delete: several(
    at(DELETE_ZONE, 'title="Delete"'),
    page(SUBJECT_PROFILE, 'title="Delete"'),
    feature(KEYS_PAGE, '> Delete <'),
  ),

  // Groups and roles.
  'Place in the tree': page(
    'groups/ui/GroupRecordPage/GeneralTab.tsx',
    'title="Place in the tree"',
  ),
  'Save Place in the tree': page(
    'groups/ui/GroupRecordPage/GeneralTab.tsx',
    'confirmLabel="Save Place in the tree"',
  ),
  'Save Roles': page('groups/ui/GroupRecordPage/RolesTab.tsx', 'confirmLabel="Save Roles"'),
  'Joined by every new subject': page(
    'groups/ui/GroupRecordPage/GeneralTab.tsx',
    'label="Joined by every new subject"',
  ),
  'Delete /eng and every group beneath it': template(
    [
      inPage(
        'groups/ui/GroupRecordPage/GeneralTab.tsx',
        '`Delete ${path} and every group beneath it`',
      ),
    ],
    'Delete ${path} and every group beneath it',
    { path: '/eng' },
  ),
  'Given to every new subject': page(
    'roles/ui/RoleRecordPage/GeneralTab.tsx',
    'label="Given to every new subject"',
  ),
  'Add a composite': page('roles/ui/RoleRecordPage/CompositesTab.tsx', 'title="Add a composite"'),
  'Take it out': page('roles/ui/RoleRecordPage/CompositesTab.tsx', 'confirmLabel="Take it out"'),
  'Delete reader': deleteNamed('roles/ui/RoleRecordPage/GeneralTab.tsx', 'reader', inPage),
  'admin capability': shared('services/capabilities/held.ts', "'admin capability'"),

  // Clients.
  'Delete my-app': deleteNamed('clients/ui/GeneralTab/GeneralTab.tsx', 'my-app', inPage),
  'Rotate the secret of my-app': template(
    [inPage('clients/ui/AdvancedTab/AdvancedTab.tsx', '`Rotate the secret of ${client.name}`')],
    'Rotate the secret of ${client.name}',
    { 'client.name': 'my-app' },
  ),
  'Rotate secret': page('clients/ui/AdvancedTab/AdvancedTab.tsx', 'confirmLabel="Rotate secret"'),
  'Grace period': page('clients/services/secretRotation.ts', "GRACE_LABEL = 'Grace period'"),
  'Revoke every token': page(
    'clients/services/sessions.ts',
    "REVOKE_HEADING = 'Revoke every token'",
  ),
  'Evaluate claims': page('clients/services/evaluate.ts', "'Evaluate claims'"),

  // Scopes.
  'In the ID token': page(SCOPE_DELIVERY, "'In the ID token'"),
  'In the access token': page(SCOPE_DELIVERY, "'In the access token'"),
  'Consent text': page(SCOPE_GENERAL, 'label="Consent text"'),
  'Display order': page(SCOPE_GENERAL, 'label="Display order"'),
  'Client to assign': page('scopes/ui/ScopeRecordPage/ClientsTab.tsx', 'label="Client to assign"'),
  'Assign to a client': page(
    'scopes/ui/ScopeRecordPage/ClientsTab.tsx',
    'title="Assign to a client"',
  ),
  'Assign it as': feature(
    'scope-assignment/ui/AssignmentControls/AssignmentControls.tsx',
    'label="Assign it as"',
  ),
  'Bound mappers': page('scopes/ui/ScopeRecordPage/MappersTab.tsx', 'label="Bound mappers"'),
  'Delete reports:read': deleteNamed(
    'scopes/ui/ScopeRecordPage/GeneralTab.tsx',
    'reports:read',
    inPage,
  ),

  // Registration tokens.
  'Mint a registration token': feature(TOKENS_PAGE, 'title="Mint a registration token"'),
  'Mint token': feature(TOKENS_PAGE, "'Mint token'"),
  Uses: feature(TOKENS_PAGE, 'label="Uses"'),
  Lifetime: feature(TOKENS_PAGE, 'label="Lifetime"'),
  'Uses left': feature(TOKENS_PAGE, "header: 'Uses left'"),
  Revoke: feature(TOKENS_PAGE, '> Revoke <'),
  'Revoke token': feature(TOKENS_PAGE, 'confirmLabel="Revoke token"'),
  Policy: feature(PLATFORM, "label: 'Policy'"),
  'Closed: only an administrator creates clients': feature(
    PLATFORM,
    "label: 'Closed: only an administrator creates clients'",
  ),
  'With a registration token': feature(PLATFORM, "label: 'With a registration token'"),

  // The sign-in flow.
  Steps: feature('flow/ui/FlowPage/FlowPage.tsx', 'title="Steps"'),
  Required: feature(FLOW_REQUIREMENTS, "label: 'Required'"),
  Alternative: feature(FLOW_REQUIREMENTS, "label: 'Alternative'"),
  Conditional: feature(FLOW_REQUIREMENTS, "label: 'Conditional'"),
  Disabled: feature(FLOW_REQUIREMENTS, "label: 'Disabled'"),
  Up: feature('flow/ui/FlowPage/FlowPage.tsx', '> Up <'),
  Down: feature('flow/ui/FlowPage/FlowPage.tsx', '> Down <'),
  'Requirement for password': template(
    [inFeature('flow/ui/FlowPage/FlowPage.tsx', '`Requirement for ${step.authenticator}`')],
    'Requirement for ${step.authenticator}',
    { 'step.authenticator': 'password' },
  ),
  'Save Steps': template(
    [
      { file: `${SHARED}/ui/SaveBar/SaveBar.tsx`, text: '`${verb} ${section}`' },
      { file: `${SHARED}/ui/SaveBar/SaveBar.tsx`, text: "(saveLabel ?? 'Save')" },
      inFeature('flow/ui/FlowPage/FlowPage.tsx', 'title="Steps"'),
    ],
    'Save ${section}',
    { section: 'Steps' },
  ),
  Save: shared('ui/SaveBar/SaveBar.tsx', "(saveLabel ?? 'Save')"),
  'One-time password': feature('flow/services/otp.ts', "OTP_TITLE = 'One-time password'"),
  'Ask every subject for a one-time password': feature(
    'flow/services/otp.ts',
    "OTP_LABEL = 'Ask every subject for a one-time password'",
  ),

  // Signing keys.
  'Stage a key': feature(KEYS_PAGE, 'title="Stage a key"'),
  'Stage key': feature(KEYS_PAGE, "'Stage key'"),
  Algorithm: feature(KEYS_PAGE, 'label="Algorithm"'),
  Rotating: feature('signing-keys/services/lanes.ts', "title: 'Rotating'"),
  Active: feature('signing-keys/services/lanes.ts', "title: 'Active'"),
  Retired: feature('signing-keys/services/lanes.ts', "title: 'Retired'"),
  Promote: feature(KEYS_PAGE, '> Promote <'),
  Retire: feature(KEYS_PAGE, '> Retire <'),
  'Promote key': feature(KEYS_CONFIRM, "confirmLabel: 'Promote key'"),
  'Retire key': feature(KEYS_CONFIRM, "confirmLabel: 'Retire key'"),
  'Delete key': feature(KEYS_CONFIRM, "confirmLabel: 'Delete key'"),
  Ready: feature('signing-keys/services/promotion.ts', "return 'Ready'"),
  'Not ready': feature('signing-keys/services/promotion.ts', "return 'Not ready'"),
  'Changes algorithm': feature('signing-keys/services/promotion.ts', "return 'Changes algorithm'"),

  // Settings.
  'Registration and recovery': feature(ACCESS, "title: 'Registration and recovery'"),
  'Remember me': feature(ACCESS, "title: 'Remember me'"),
  Usernames: feature(ACCESS, "title: 'Usernames'"),
  'Password policy': feature(ACCESS, "title: 'Password policy'"),
  'Brute force': feature(ACCESS, "title: 'Brute force'"),
  'Token lifetimes': feature(PLATFORM, "title: 'Token lifetimes'"),
  'Dynamic client registration': feature(PLATFORM, "title: 'Dynamic client registration'"),
  'Audit retention': feature(PLATFORM, "title: 'Audit retention'"),
  'Idle timeout': feature(ACCESS, "label: 'Idle timeout'"),
  'Maximum lifetime': feature(ACCESS, "label: 'Maximum lifetime'"),
  'Self-registration': feature(ACCESS, "label: 'Self-registration'"),
  'Verify email addresses': feature(ACCESS, "label: 'Verify email addresses'"),
  'Minimum length': feature(ACCESS, "label: 'Minimum length'"),
  'Password lifetime': feature(ACCESS, "label: 'Password lifetime'"),
  'Failures before a lockout': feature(ACCESS, "label: 'Failures before a lockout'"),
  'Keep events for': feature(PLATFORM, "label: 'Keep events for'"),
  Enabled: feature(ACCESS, "label: 'Enabled'"),
  'Clear all lockouts': feature('settings/services/lockouts.ts', "'Clear all lockouts'"),
  'Disable demo': template(
    [inPage('tenants/ui/GeneralTab/GeneralTab.tsx', 'confirmLabel={`Disable ${name}`}')],
    'Disable ${name}',
    { name: 'demo' },
  ),

  // Email.
  'Mail relay': feature('email/use-cases/useRelaySection.ts', "'Mail relay'"),
  Host: feature(EMAIL_RELAY, "host: 'Host'"),
  Port: feature(EMAIL_RELAY, "port: 'Port'"),
  'Sender address': feature(EMAIL_RELAY, "from_address: 'Sender address'"),
  'New password': feature(EMAIL_RELAY, "password: 'New password'"),
  'Require TLS (STARTTLS)': feature(EMAIL_RELAY, "starttls: 'Require TLS (STARTTLS)'"),
  'Remove the stored password': feature(
    EMAIL_RELAY,
    "remove_password: 'Remove the stored password'",
  ),
  'Test message': feature(EMAIL_PAGE, 'title="Test message"'),
  'Send to': feature(EMAIL_PAGE, 'label="Send to"'),
  'Send test message': feature(EMAIL_PAGE, "'Send test message'"),
  'Send as client': feature('email/services/testClient.ts', "TEST_AS_LABEL = 'Send as client'"),
  'Use the tenant’s own look': feature(
    'email/services/testClient.ts',
    "TEST_TENANT_OWN = 'Use the tenant’s own look'",
  ),
  'Remove the relay': several(
    feature(EMAIL_PAGE, 'title="Remove the relay"'),
    feature(EMAIL_PAGE, 'confirmLabel="Remove the relay"'),
  ),
  Delivery: feature(EMAIL_MAIL, "'Delivery'"),
  Show: feature('email/ui/MailDelivery/MailDelivery.tsx', 'label="Show"'),
  Refresh: feature('email/ui/MailDelivery/MailDelivery.tsx', '>Refresh<'),
  Queued: feature(EMAIL_MAIL, "'Queued'"),
  Retrying: feature(EMAIL_MAIL, "'Retrying'"),
  Sent: feature(EMAIL_MAIL, "'Sent'"),
  Failed: several(feature(EMAIL_MAIL, "'Failed'"), page(AUDIT_KINDS, "'Failed'")),
  'not sent': feature('email/services/effective.ts', "return 'not sent'"),
  'deployment sender': feature('email/services/effective.ts', "return 'deployment sender'"),
  'own relay': feature('email/services/effective.ts', "return 'own relay'"),

  // Branding.
  Theme: tab('branding', 'theme', 'Theme'),
  Pages: tab('branding', 'pages', 'Pages'),
  Mail: tab('branding', 'mail', 'Mail'),
  Languages: tab('branding', 'languages', 'Languages'),
  'What the mail inherits': several(
    feature('branding/services/mail.ts', "MAIL_INHERITS_TITLE = 'What the mail inherits'"),
    feature('branding/ui/MailTab/MailTab.tsx', '{MAIL_INHERITS_TITLE}'),
  ),
  'Preview as client': feature('branding/services/mail.ts', "MAIL_AS_LABEL = 'Preview as client'"),
  'Show the tenant’s own': feature(
    'branding/services/mail.ts',
    "MAIL_TENANT_OWN = 'Show the tenant’s own'",
  ),
  'Message background': feature('branding/services/mail.ts', "label: 'Message background'"),
  'Link box background': feature('branding/services/mail.ts', "label: 'Link box background'"),
  'Quiet text': feature('branding/services/mail.ts', "label: 'Quiet text'"),
  'Button text': feature('branding/services/mail.ts', "label: 'Button text'"),
  'Supported languages': feature(
    'branding/services/languages.ts',
    "SUPPORTED_LABEL = 'Supported languages'",
  ),
  'Default language': feature(
    'branding/services/languages.ts',
    "DEFAULT_LABEL = 'Default language'",
  ),
  'Message overrides': feature(
    'branding/services/overrides.ts',
    "OVERRIDES_TITLE = 'Message overrides'",
  ),
  Edit: feature('branding/ui/LanguagesTab/LanguagesTab.tsx', '> Edit </Button>'),
  Remove: feature('branding/ui/LanguagesTab/LanguagesTab.tsx', '> Remove </Button>'),
  'Colours and font': feature(
    'branding/services/colourSection.ts',
    "COLOURS_TITLE = 'Colours and font'",
  ),
  'Use my own light colours': template(
    [inFeature('branding/services/colourSection.ts', 'Use my own ${scheme} colours')],
    'Use my own ${scheme} colours',
    { scheme: 'light' },
  ),
  Images: feature('branding/services/imageSection.ts', "IMAGES_TITLE = 'Images'"),
  Stylesheet: feature('branding/services/fields.ts', "STYLESHEET_SECTION_TITLE = 'Stylesheet'"),
  Contrast: feature('branding/services/contrast.ts', "CONTRAST_TITLE = 'Contrast'"),
  Publish: feature('branding/services/publish.ts', "PUBLISH_TITLE = 'Publish'"),
  Versions: feature('branding/services/versions.ts', "VERSIONS_TITLE = 'Versions'"),
  'Reset to default': feature('branding/services/versions.ts', "RESET_TITLE = 'Reset to default'"),
  'Revert to published': feature(
    'branding/services/publication.ts',
    "REVERT_TITLE = 'Revert to published'",
  ),
  'Revert this tab to published': feature(
    'branding/services/publication.ts',
    "REVERT_LABEL = 'Revert this tab to published'",
  ),
  'Discard draft': feature('branding/services/publication.ts', "DISCARD_CONFIRM = 'Discard draft'"),
  'Delete image': feature('branding/services/imageSection.ts', "DELETE_LABEL = 'Delete image'"),
  Preview: feature('branding/services/preview.ts', "PREVIEW_TITLE = 'Preview'"),
  'Colour scheme': several(
    feature('branding/services/preview.ts', "PREVIEW_SCHEME_LABEL = 'Colour scheme'"),
    feature('branding/services/mail.ts', "MAIL_SCHEME_LABEL = 'Colour scheme'"),
  ),
  'Open preview': feature('branding/services/preview.ts', "PREVIEW_OPEN_LABEL = 'Open preview'"),
  'Page preview': feature('branding/services/preview.ts', "PREVIEW_SHEET_TITLE = 'Page preview'"),
  'Close preview': feature('branding/services/preview.ts', "PREVIEW_CLOSE_LABEL = 'Close preview'"),
  More: feature('branding/services/publication.ts', "MORE_TRIGGER = 'More'"),
  'Wrap lines': shared('services/code/tokens.ts', "WRAP_LABEL = 'Wrap lines'"),
  'Message key': feature('branding/services/overrides.ts', "KEY_LABEL = 'Message key'"),
  'Add language': feature('branding/services/languages.ts', "ADD_BUTTON = 'Add language'"),
  'Insert a message': feature(
    'branding/services/catalogue.ts',
    "INSERT_LABEL = 'Insert a message'",
  ),
  'Selectors you can use': feature(
    'branding/services/selectors.ts',
    "SELECTORS_LABEL = 'Selectors you can use'",
  ),
  'Design values you can use': feature(
    'branding/services/selectors.ts',
    "VALUES_LABEL = 'Design values you can use'",
  ),
  Translations: page('clients/services/clientDetails.ts', "translations: 'Translations'"),
  'Description by language': page(
    'scopes/services/scopeConsent.ts',
    "DESCRIPTION_LANGUAGES_LABEL = 'Description by language'",
  ),
  'Consent text by language': page(
    'scopes/services/scopeConsent.ts',
    "CONSENT_LANGUAGES_LABEL = 'Consent text by language'",
  ),

  // The audit trail.
  'Event type': page(FILTERS, "label: 'Event type'"),
  Outcome: page(FILTERS, "label: 'Outcome'"),
  Action: page(FILTERS, "label: 'Action'"),
  'Resource type': page(FILTERS, "label: 'Resource type'"),
  'Resource id': page(FILTERS, "label: 'Resource id'"),
  'Actor (subject id)': page(FILTERS, "label: 'Actor (subject id)'"),
  From: page(FILTERS, "label: 'From'"),
  To: page(FILTERS, "label: 'To'"),
  'Apply filters': page(FILTERS, "apply: 'Apply filters'"),
  'Admin change': page(AUDIT_KINDS, "'Admin change'"),
  'Admin access': page(AUDIT_KINDS, "'Admin access'"),
  Authentication: page(AUDIT_KINDS, "'Authentication'"),
  Session: page(AUDIT_KINDS, "'Session'"),
  Token: page(AUDIT_KINDS, "'Token'"),
  Credential: page(AUDIT_KINDS, "'Credential'"),
  Allowed: page(AUDIT_KINDS, "'Allowed'"),
  Refused: page(AUDIT_KINDS, "'Refused'"),
  Details: entity('audit-event/ui/AuditTable/AuditTable.tsx', '> Details <'),
  'Export these events': page('audit/services/auditPageWords.ts', "'Export these events'"),

  // The overview.
  'Needs attention': feature(
    'overview/ui/AttentionPanel/AttentionPanel.tsx',
    'title="Needs attention"',
  ),
  Counts: feature('overview/ui/CountsPanel/CountsPanel.tsx', 'title="Counts"'),
  Discovery: feature('overview/ui/DiscoveryPanel/DiscoveryPanel.tsx', 'title="Discovery"'),
  Issuer: feature('overview/ui/DiscoveryPanel/DiscoveryPanel.tsx', '>Issuer<'),
  'Latest activity': feature('overview/ui/LatestAudit/LatestAudit.tsx', 'title="Latest activity"'),
  'Open the audit trail': feature(
    'overview/ui/LatestAudit/LatestAudit.tsx',
    '> Open the audit trail <',
  ),

  // Tenants and their administrators.
  'Export to a file': page('tenants/ui/ExportPanel/ExportPanel.tsx', "'Export to a file'"),
  'Include subjects': page('tenants/ui/ExportPanel/ExportPanel.tsx', 'label="Include subjects"'),
  Import: page(TENANT_IMPORT, "'Import'"),
  'Choose a file…': page(TENANT_IMPORT, '> Choose a file… <'),
  'Tenant document': page(TENANT_IMPORT, '> Tenant document <'),
  'Add an administrator': several(
    page(SYSTEM_PAGE, '> Add an administrator <'),
    page('tenants/ui/AdministratorsTab/AdministratorsTab.tsx', '>Add an administrator<'),
  ),
  'Subject in system': page(SYSTEM_PAGE, 'label="Subject in system"'),
  'What they hold': several(
    page(SYSTEM_PAGE, 'label="What they hold"'),
    page(TENANT_NEW, 'label="What they hold"'),
  ),
  'Give it to the chosen subject': page(SYSTEM_PAGE, "'Give it to the chosen subject'"),
  'Full (tenant-admin)': at(`${SHARED}/services/capabilities/holdings.ts`, "'Full (tenant-admin)'"),
  'Change admin@odudu.local’s capabilities': template(
    [
      inFeature(
        'subject-capabilities/ui/CapabilityHolders/CapabilityHolders.tsx',
        '`Change ${holder.name}’s capabilities`',
      ),
    ],
    'Change ${holder.name}’s capabilities',
    { 'holder.name': 'admin@odudu.local' },
  ),
  Availability: page('clients/services/clientDetails.ts', "'Availability'"),
  'Consent required': page('clients/ui/GeneralTab/GeneralTab.tsx', 'label="Consent required"'),
  'Consent screen links': page('clients/services/clientDetails.ts', "'Consent screen links'"),
  'Home page': page('clients/ui/GeneralTab/GeneralTab.tsx', 'label="Home page"'),
  'Privacy policy': page('clients/ui/GeneralTab/GeneralTab.tsx', 'label="Privacy policy"'),
  'Terms of service': page('clients/ui/GeneralTab/GeneralTab.tsx', 'label="Terms of service"'),
  'Client credentials scopes': page(
    'clients/ui/TokensTab/TokensTab.tsx',
    'label="Client credentials scopes"',
  ),
  'ID token claims': page('clients/services/evaluate.ts', "label: 'ID token claims'"),
  'Access token claims': page('clients/services/evaluate.ts', "label: 'Access token claims'"),
  'UserInfo claims': page('clients/services/evaluate.ts', "label: 'UserInfo claims'"),
  'Skip the sign-out confirmation': page(
    'clients/services/logoutSettings.ts',
    "SKIP_LOGOUT_LABEL = 'Skip the sign-out confirmation'",
  ),
  'Back-channel logout address': page(
    'clients/ui/LogoutTab/LogoutTab.tsx',
    'label="Back-channel logout address"',
  ),
  'Front-channel logout address': page(
    'clients/ui/LogoutTab/LogoutTab.tsx',
    'label="Front-channel logout address"',
  ),
  Installation: page('clients/services/installation.ts', "'Installation'"),
  'Discovery URL': page('clients/services/installation.ts', "label: 'Discovery URL'"),
  'Client type': page('clients/services/installation.ts', "label: 'Client type'"),
  'Authentication method': page(
    'clients/ui/AdvancedTab/AdvancedTab.tsx',
    'label="Authentication method"',
  ),
  'Certificate subject': page(
    'clients/ui/AdvancedTab/AdvancedTab.tsx',
    'label="Certificate subject"',
  ),
  'Key source': page('clients/ui/AdvancedTab/AdvancedTab.tsx', 'label="Key source"'),
  'None published': page('clients/services/clientKeys.ts', "label: 'None published'"),
  'A JWKS URI': page('clients/services/clientKeys.ts', "label: 'A JWKS URI'"),
  'A key set pasted here': page('clients/services/clientKeys.ts', "label: 'A key set pasted here'"),
  'Signing algorithm': page('clients/ui/AdvancedTab/AdvancedTab.tsx', 'label="Signing algorithm"'),
  'Plain JSON, not signed': page(
    'clients/services/userinfoResponse.ts',
    "label: 'Plain JSON, not signed'",
  ),
  'Encryption algorithm': page(
    'clients/ui/AdvancedTab/AdvancedTab.tsx',
    'label="Encryption algorithm"',
  ),
  'Not encrypted': page('clients/services/userinfoResponse.ts', "label: 'Not encrypted'"),
  'Content encryption': page(
    'clients/ui/AdvancedTab/AdvancedTab.tsx',
    'label="Content encryption"',
  ),
  'Response type': page('clients/services/tokenExchange.ts', "label: 'Response type'"),
  Audiences: page('clients/ui/AdvancedTab/AdvancedTab.tsx', 'label="Audiences"'),
  'Allow impersonation in token exchange': page(
    'clients/services/tokenExchange.ts',
    "'Allow impersonation in token exchange'",
  ),
  'New subjects': page('roles/use-cases/useRoleGeneral.ts', "label: 'New subjects'"),
  'Tenant or client': page('roles/ui/RolesPage/RolesPage.tsx', "label: 'Tenant or client'"),
  'New clients': page('scopes/use-cases/useScopeGeneral.ts', "label: 'New clients'"),
  'Assigned as default': page('scopes/services/scopeDelivery.ts', "label: 'Assigned as default'"),
  'Assigned as optional': page('scopes/services/scopeDelivery.ts', "label: 'Assigned as optional'"),
  'Not assigned': page('scopes/services/scopeDelivery.ts', "label: 'Not assigned'"),
  'Sessions per browser': feature(
    'settings/services/accessSections.ts',
    "label: 'Sessions per browser'",
  ),
  'Time to finish a sign-in': feature(
    'settings/services/accessSections.ts',
    "label: 'Time to finish a sign-in'",
  ),
  'Offer remember me': feature('settings/services/accessSections.ts', "label: 'Offer remember me'"),
  'Verification link lifetime': feature(
    'settings/services/accessSections.ts',
    "label: 'Verification link lifetime'",
  ),
  'Password reset by mail': feature(
    'settings/services/accessSections.ts',
    "label: 'Password reset by mail'",
  ),
  'Reset link lifetime': feature(
    'settings/services/accessSections.ts',
    "label: 'Reset link lifetime'",
  ),
  'Usernames can be renamed': feature(
    'settings/services/accessSections.ts',
    "label: 'Usernames can be renamed'",
  ),
  'Sign in with a verified email address': feature(
    'settings/services/accessSections.ts',
    "label: 'Sign in with a verified email address'",
  ),
  'Require a digit': feature('settings/services/accessSections.ts', "label: 'Require a digit'"),
  'Require an uppercase letter': feature(
    'settings/services/accessSections.ts',
    "label: 'Require an uppercase letter'",
  ),
  'Require a lowercase letter': feature(
    'settings/services/accessSections.ts',
    "label: 'Require a lowercase letter'",
  ),
  'Require a special character': feature(
    'settings/services/accessSections.ts',
    "label: 'Require a special character'",
  ),
  'Refuse the username': feature(
    'settings/services/accessSections.ts',
    "label: 'Refuse the username'",
  ),
  'Refuse the email address': feature(
    'settings/services/accessSections.ts',
    "label: 'Refuse the email address'",
  ),
  'Passwords remembered': feature(
    'settings/services/accessSections.ts',
    "label: 'Passwords remembered'",
  ),
  'First lockout': feature('settings/services/accessSections.ts', "label: 'First lockout'"),
  'Longest lockout': feature('settings/services/accessSections.ts', "label: 'Longest lockout'"),
  'Failures forgotten after': feature(
    'settings/services/accessSections.ts',
    "label: 'Failures forgotten after'",
  ),
  'Access token': feature('settings/services/platformSections.ts', "label: 'Access token'"),
  'ID token': feature('settings/services/platformSections.ts', "label: 'ID token'"),
  'Refresh token': feature('settings/services/platformSections.ts', "label: 'Refresh token'"),
  'Authorization code': feature(
    'settings/services/platformSections.ts',
    "label: 'Authorization code'",
  ),
  'Open: any application may register': feature(
    'settings/services/platformSections.ts',
    "label: 'Open: any application may register'",
  ),
  'Most clients': feature('settings/services/platformSections.ts', "label: 'Most clients'"),
  'Events recorded': feature('settings/services/platformSections.ts', "label: 'Events recorded'"),
  'Changes by administrators': feature(
    'settings/services/platformSections.ts',
    "label: 'Changes by administrators'",
  ),
  'Reads by administrators': feature(
    'settings/services/platformSections.ts',
    "label: 'Reads by administrators'",
  ),
  'Sign-ins and refused sign-ins': feature(
    'settings/services/platformSections.ts',
    "label: 'Sign-ins and refused sign-ins'",
  ),
  'Sessions starting and ending': feature(
    'settings/services/platformSections.ts',
    "label: 'Sessions starting and ending'",
  ),
  'Tokens issued and revoked': feature(
    'settings/services/platformSections.ts',
    "label: 'Tokens issued and revoked'",
  ),
  'Passwords, keys and codes set or changed': feature(
    'settings/services/platformSections.ts',
    "label: 'Passwords, keys and codes set or changed'",
  ),
  'Add a step': feature('flow/ui/FlowPage/FlowPage.tsx', 'label="Add a step"'),
  'Requirement of the new step': feature(
    'flow/ui/FlowPage/FlowPage.tsx',
    'label="Requirement of the new step"',
  ),
  'ES256 (elliptic curve)': feature(
    'signing-keys/services/stage.ts',
    "label: 'ES256 (elliptic curve)'",
  ),
  'RS256 (RSA)': feature('signing-keys/services/stage.ts', "label: 'RS256 (RSA)'"),
  'Holding anything or nothing': page(
    'subjects/services/subjectFilters.ts',
    "label: 'Holding anything or nothing'",
  ),
  'Given name': page('subjects/services/claims.ts', "label: 'Given name'"),
  'Family name': page('subjects/services/claims.ts', "label: 'Family name'"),
  'Middle name': page('subjects/services/claims.ts', "label: 'Middle name'"),
  'Preferred username': page('subjects/services/claims.ts', "label: 'Preferred username'"),
  'Phone number verified': page(
    'subjects/ui/SubjectRecordPage/ProfileTab.tsx',
    'label="Phone number verified"',
  ),
  Locality: page('subjects/services/claims.ts', "label: 'Locality'"),
  Region: page('subjects/services/claims.ts', "label: 'Region'"),
  'Postal code': page('subjects/services/claims.ts', "label: 'Postal code'"),
  'Ask for a new set at next sign-in': page(
    'subjects/services/credentialAsk.ts',
    "label: 'Ask for a new set at next sign-in'",
  ),
  'Choose a new password': page(
    'subjects/services/requiredActions.ts',
    "label: 'Choose a new password'",
  ),
  'Set up an authenticator app': page(
    'subjects/services/requiredActions.ts',
    "label: 'Set up an authenticator app'",
  ),
  'Register a passkey': page('subjects/services/requiredActions.ts', "label: 'Register a passkey'"),
  'Generate recovery codes': page(
    'subjects/services/requiredActions.ts',
    "label: 'Generate recovery codes'",
  ),
  'Required actions to email': page(
    'subjects/ui/SubjectRecordPage/CredentialsTab.tsx',
    'label="Required actions to email"',
  ),
  'Filter administrators': feature(
    'subject-capabilities/ui/CapabilityHolders/CapabilityHolders.tsx',
    'label="Filter administrators"',
  ),
  'Which tenant do you administer?': at(
    'apps/admin-console/src/widgets/session-gate/ui/SignIn/SignIn.tsx',
    'label="Which tenant do you administer?"',
  ),
  Consent: page('clients/services/clientDetails.ts', "consent: 'Consent'"),
  'Full name': page('subjects/services/claims.ts', "label: 'Full name'"),
  Nickname: page('subjects/services/claims.ts', "label: 'Nickname'"),
  Gender: page('subjects/services/claims.ts', "label: 'Gender'"),
  Birthdate: page('subjects/services/claims.ts', "label: 'Birthdate'"),
  'Time zone': page('subjects/services/claims.ts', "label: 'Time zone'"),
  Locale: page('subjects/services/claims.ts', "label: 'Locale'"),
  'Profile page': page('subjects/services/claims.ts', "label: 'Profile page'"),
  Website: page('subjects/services/claims.ts', "label: 'Website'"),
  Picture: page('subjects/services/claims.ts', "label: 'Picture'"),
  'Phone number': page('subjects/services/claims.ts', "label: 'Phone number'"),
  'Formatted address': page('subjects/services/claims.ts', "label: 'Formatted address'"),
  Street: page('subjects/services/claims.ts', "label: 'Street'"),
  Country: page('subjects/services/claims.ts', "label: 'Country'"),
};
