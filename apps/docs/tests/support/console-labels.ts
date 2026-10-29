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

// The menu entry of an area, whose label areas.ts gives beside its path.
const AREAS = `${FEATURES}/shell/service/areas.ts`;
const rail = (path: string, label: string): Defined => at(AREAS, `area('${path}', '${label}'`);
const heading = (label: string): Defined => at(AREAS, `heading: '${label}'`);

const tab = (feature_: string, key: string, label: string): Defined =>
  feature(`${feature_}/service/tabs.ts`, `${key}: '${label}'`);
const subjectTab = (key: string, label: string): Defined => tab('subjects', key, label);
const clientTab = (key: string, label: string): Defined => tab('clients', key, label);

const FILTERS = 'audit/view/AuditFilters/AuditFilters.tsx';
const AUDIT_KINDS = 'audit/service/filters.ts';
const EMAIL_PAGE = 'email/view/EmailPage/EmailPage.tsx';
const EMAIL_RELAY = 'email/service/relay.ts';
const EMAIL_MAIL = 'email/service/mail.ts';
const ACCESS = 'settings/service/accessSections.ts';
const PLATFORM = 'settings/service/platformSections.ts';
const KEYS_PAGE = 'signing-keys/view/SigningKeysPage/SigningKeysPage.tsx';
const KEYS_CONFIRM = 'signing-keys/service/confirm.ts';
const TOKENS_PAGE = 'registration-tokens/view/RegistrationTokensPage/RegistrationTokensPage.tsx';
const FLOW_REQUIREMENTS = 'flow/service/requirements.ts';
const SCOPE_GENERAL = 'scopes/view/ScopeRecordPage/GeneralTab.tsx';
const SCOPE_VALUES = 'scopes/service/general.ts';
const CLIENT_NEW = 'clients/view/NewClientPage/NewClientPage.tsx';
const TENANT_NEW = 'tenants/view/NewTenantPage/NewTenantPage.tsx';
const TENANT_IMPORT = 'tenants/view/ImportTenantPage/ImportTenantPage.tsx';
const SYSTEM_PAGE = 'system-admins/view/SystemAdministratorsPage/SystemAdministratorsPage.tsx';
const SUBJECT_PROFILE = 'subjects/view/SubjectRecordPage/ProfileTab.tsx';
const CREATION_FORM = `${SHARED}/view/CreationForm/CreationForm.tsx`;
const DELETE_ZONE = `${SHARED}/view/DeleteZone/DeleteZone.tsx`;

const createWith = (noun: string, page: string): Defined =>
  template(
    [{ file: CREATION_FORM, text: '`Create ${noun}`' }, inFeature(page, `noun="${noun}"`)],
    'Create ${noun}',
    { noun },
  );

const deleteNamed = (page: string, subject: string): Defined =>
  template(
    [{ file: DELETE_ZONE, text: '`Delete ${name}`' }, inFeature(page, '<DeleteZone')],
    'Delete ${name}',
    { name: subject },
  );

export const DEFINED: Readonly<Record<string, Defined>> = {
  // Sign-in, as the console and Odudu's own page word it.
  'Continue to sign-in': feature('session/service/labels.ts', "return 'Continue to sign-in'"),
  Username: several(
    at(MESSAGES, "'login.username': 'Username'"),
    feature('subjects/view/NewSubjectPage/NewSubjectPage.tsx', 'label="Username"'),
    feature(TENANT_NEW, 'label="Username"'),
    feature(EMAIL_RELAY, "username: 'Username'"),
    feature('subjects/view/CapabilityHolders/CapabilityHolders.tsx', "label: 'Username'"),
  ),
  Password: at(MESSAGES, "'login.password': 'Password'"),
  'Sign out': feature('shell/view/RailFooter/RailFooter.tsx', 'Sign out'),
  // The panel a failed page is replaced by.
  'Something went wrong': feature(
    'failure/service/wording.ts',
    "FAILURE_TITLE = 'Something went wrong'",
  ),
  'Try again': feature('failure/service/wording.ts', "TRY_AGAIN_LABEL = 'Try again'"),
  'Back to overview': feature(
    'failure/service/wording.ts',
    "BACK_TO_OVERVIEW_LABEL = 'Back to overview'",
  ),
  'Reload the console': feature(
    'failure/service/wording.ts',
    "RELOAD_LABEL = 'Reload the console'",
  ),
  'Error ID': feature('failure/service/report.ts', '`Error ID: ${report.id}`'),
  Copy: shared('view/CopyValue/CopyValue.tsx', 'Copy'),
  'Back to system': shared('view/ContextBar/ContextBar.tsx', 'Back to system'),

  // The menu: its headings and its entries.
  SYSTEM: heading('System'),
  IDENTITY: heading('Identity'),
  APPLICATIONS: heading('Applications'),
  SECURITY: heading('Security'),
  TENANT: heading('Tenant'),
  OBSERVE: heading('Observe'),
  Overview: several(
    at(AREAS, "area('', 'Overview'"),
    feature('overview/view/OverviewPage/OverviewPage.tsx', 'title="Overview"'),
  ),
  Subjects: rail('subjects', 'Subjects'),
  Groups: several(rail('groups', 'Groups'), subjectTab('groups', 'Groups')),
  Roles: several(
    rail('roles', 'Roles'),
    subjectTab('roles', 'Roles'),
    tab('groups', 'roles', 'Roles'),
    tab('scopes', 'roles', 'Roles'),
    clientTab('roles', 'Roles'),
  ),
  Clients: several(rail('clients', 'Clients'), tab('scopes', 'clients', 'Clients')),
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
    feature('subjects/view/NewSubjectPage/NewSubjectPage.tsx', 'label="Email"'),
    feature(TENANT_NEW, 'label="Email"'),
  ),
  Export: several(
    rail('export', 'Export'),
    feature('tenants/view/TenantRecordPage/TenantRecordPage.tsx', "'Export'"),
  ),
  'Audit trail': rail('audit', 'Audit trail'),
  Tenants: rail('tenants', 'Tenants'),
  'System administrators': rail('system-admins', 'System administrators'),

  // Tabs of a record.
  Profile: subjectTab('profile', 'Profile'),
  Credentials: subjectTab('credentials', 'Credentials'),
  'Required actions': feature('subjects/service/tabs.ts', "'required-actions': 'Required actions'"),
  Consents: subjectTab('consents', 'Consents'),
  Grants: subjectTab('grants', 'Grants'),
  Activity: several(
    subjectTab('activity', 'Activity'),
    clientTab('activity', 'Activity'),
    tab('groups', 'activity', 'Activity'),
    tab('roles', 'activity', 'Activity'),
    tab('scopes', 'activity', 'Activity'),
  ),
  General: several(
    clientTab('general', 'General'),
    tab('groups', 'general', 'General'),
    tab('roles', 'general', 'General'),
    tab('scopes', 'general', 'General'),
    feature('tenants/view/GeneralTab/GeneralTab.tsx', 'title="General"'),
    feature(ACCESS, "title: 'General'"),
  ),
  'Redirects & origins': clientTab('redirects', 'Redirects & origins'),
  Tokens: clientTab('tokens', 'Tokens'),
  Logout: clientTab('logout', 'Logout'),
  Advanced: clientTab('advanced', 'Advanced'),
  'Service account': clientTab('service', 'Service account'),
  Members: several(tab('groups', 'members', 'Members'), tab('roles', 'members', 'Members')),
  Composites: tab('roles', 'composites', 'Composites'),
  'Claim mappers': tab('scopes', 'mappers', 'Claim mappers'),
  Administrators: feature('tenants/view/TenantRecordPage/TenantRecordPage.tsx', "'Administrators'"),

  // Creating things.
  'Create a tenant': feature('tenants/view/TenantsPage/TenantsPage.tsx', '> Create a tenant <'),
  'Create a client': feature('clients/view/ClientsPage/ClientsPage.tsx', '> Create a client <'),
  'Create a subject': feature(
    'subjects/view/SubjectsPage/SubjectsPage.tsx',
    '> Create a subject <',
  ),
  'Create a group': feature('groups/view/GroupsPage/GroupsPage.tsx', '> Create a group <'),
  'Create a role': feature('roles/view/RolesPage/RolesPage.tsx', '> Create a role <'),
  'Create a scope': feature('scopes/view/ScopesPage/ScopesPage.tsx', '> Create a scope <'),
  'Restore built-in scopes': feature(
    'scopes/view/ScopesPage/RestoreScopes.tsx',
    '>Restore built-in scopes<',
  ),
  Restore: feature('scopes/service/restore.ts', "RESTORE_CONFIRM_LABEL = 'Restore'"),
  'Include all roles in tokens': feature(
    'clients/service/tokens.ts',
    "FULL_SCOPE_LABEL = 'Include all roles in tokens'",
  ),
  'Used because nothing is bound': feature(
    'scopes/service/mappers.ts',
    "DEFAULT_MAPPER_NOTE = 'Used because nothing is bound'",
  ),
  'Create a copy': feature('roles/view/RoleRecordPage/RoleRecordPage.tsx', '> Create a copy <'),
  'Import a tenant': several(
    feature('tenants/view/TenantsPage/TenantsPage.tsx', '>Import a tenant<'),
    feature(TENANT_IMPORT, 'title="Import a tenant"'),
  ),
  'Create tenant': feature(TENANT_NEW, "'Create tenant'"),
  'Create client': createWith('client', CLIENT_NEW),
  'Create subject': createWith('subject', 'subjects/view/NewSubjectPage/NewSubjectPage.tsx'),
  'Create group': createWith('group', 'groups/view/NewGroupPage/NewGroupPage.tsx'),
  'Create role': createWith('role', 'roles/view/NewRolePage/NewRolePage.tsx'),
  'Create scope': createWith('scope', 'scopes/view/NewScopePage/NewScopePage.tsx'),
  'Create administrator': feature(TENANT_NEW, "'Create administrator'"),
  'Create a new subject as an administrator': feature(
    SYSTEM_PAGE,
    '>Create a new subject as an administrator<',
  ),
  Name: several(
    feature(TENANT_NEW, 'label="Name"'),
    feature(TENANT_IMPORT, 'label="Name"'),
    feature(CLIENT_NEW, 'label="Name"'),
    at(CREATION_FORM, 'label="Name"'),
  ),
  'Display name': several(
    feature(TENANT_NEW, 'label="Display name"'),
    feature(TENANT_IMPORT, 'label="Display name"'),
    feature('tenants/usecase/useTenantGeneral.ts', "label: 'Display name'"),
  ),
  Description: several(
    at(CREATION_FORM, 'label="Description"'),
    feature(CLIENT_NEW, 'label="Description"'),
  ),
  'Client ID': feature(CLIENT_NEW, 'label="Client ID"'),
  Kind: feature(CLIENT_NEW, 'label="Kind"'),
  'Web application': feature('clients/service/create.ts', "label: 'Web application'"),
  Service: feature('clients/service/create.ts', "label: 'Service'"),
  'Public application': feature('clients/service/create.ts', "label: 'Public application'"),
  'Redirect URIs': several(
    feature(CLIENT_NEW, 'label="Redirect URIs"'),
    feature('clients/view/RedirectsTab/RedirectsTab.tsx', 'label="Redirect URIs"'),
  ),
  'Post-logout redirect URIs': feature(
    'clients/view/LogoutTab/LogoutTab.tsx',
    'label="Post-logout redirect URIs"',
  ),
  Parent: feature('groups/view/NewGroupPage/NewGroupPage.tsx', 'label="Parent"'),
  'Enter demo': template(
    [inFeature('tenants/view/TenantsPage/TenantsPage.tsx', '`Enter ${tenant.name}`')],
    'Enter ${tenant.name}',
    { 'tenant.name': 'demo' },
  ),
  'Open demo': template([inFeature(TENANT_NEW, '`Open ${step.tenant}`')], 'Open ${step.tenant}', {
    'step.tenant': 'demo',
  }),

  // Finding things in a list.
  Capability: feature('subjects/view/SubjectsPage/SubjectsPage.tsx', 'label="Capability"'),
  Status: several(
    feature('subjects/view/SubjectsPage/SubjectsPage.tsx', 'label="Status"'),
    feature('tenants/view/TenantsPage/TenantsPage.tsx', 'label="Status"'),
    feature('subjects/view/CapabilityHolders/CapabilityHolders.tsx', 'label="Status"'),
  ),
  Holds: feature('subjects/view/CapabilityHolders/CapabilityHolders.tsx', 'label="Holds"'),
  'Belongs to': feature('roles/view/RolesPage/RolesPage.tsx', 'label="Belongs to"'),
  Previous: shared('view/Pager/Pager.tsx', 'Previous'),
  Next: shared('view/Pager/Pager.tsx', 'Next'),

  // Subjects.
  'Issue a one-time password': feature(
    'subjects/view/SubjectRecordPage/CredentialsTab.tsx',
    'Issue a one-time password',
  ),
  'Issue password': feature('subjects/service/credentials.ts', "confirmLabel: 'Issue password'"),
  'Send a password reset email': feature(
    'subjects/view/SubjectRecordPage/CredentialsTab.tsx',
    '> Send a password reset email <',
  ),
  'Revoke recovery codes': feature(
    'subjects/service/credentials.ts',
    "confirmLabel: 'Revoke recovery codes'",
  ),
  'Revoke grants': feature(
    'subjects/view/SubjectRecordPage/GrantsTab.tsx',
    'confirmLabel="Revoke grants"',
  ),
  'End session': feature(
    'subjects/view/SubjectRecordPage/SessionsTab.tsx',
    'confirmLabel="End session"',
  ),
  'End every session': several(
    feature('subjects/view/SubjectRecordPage/SessionsTab.tsx', 'confirmLabel="End every session"'),
    feature(
      'tenant-sessions/view/TenantSessionsPage/TenantSessionsPage.tsx',
      'confirmLabel="End every session"',
    ),
  ),
  'Admin capabilities': feature(
    'subjects/view/SubjectRecordPage/CapabilityEditor.tsx',
    'title="Admin capabilities"',
  ),
  'Disable ada': template([inFeature(SUBJECT_PROFILE, '`Disable ${name}`')], 'Disable ${name}', {
    name: 'ada',
  }),
  'Delete ada': template([inFeature(SUBJECT_PROFILE, '`Delete ${name}`')], 'Delete ${name}', {
    name: 'ada',
  }),
  Delete: several(
    at(DELETE_ZONE, 'title="Delete"'),
    feature(SUBJECT_PROFILE, 'title="Delete"'),
    feature(KEYS_PAGE, '> Delete <'),
  ),

  // Groups and roles.
  'Place in the tree': feature(
    'groups/view/GroupRecordPage/GeneralTab.tsx',
    'title="Place in the tree"',
  ),
  'Save Place in the tree': feature(
    'groups/view/GroupRecordPage/GeneralTab.tsx',
    'confirmLabel="Save Place in the tree"',
  ),
  'Save Roles': feature('groups/view/GroupRecordPage/RolesTab.tsx', 'confirmLabel="Save Roles"'),
  'Joined by every new subject': feature(
    'groups/view/GroupRecordPage/GeneralTab.tsx',
    'label="Joined by every new subject"',
  ),
  'Delete /eng and every group beneath it': template(
    [
      inFeature(
        'groups/view/GroupRecordPage/GeneralTab.tsx',
        '`Delete ${path} and every group beneath it`',
      ),
    ],
    'Delete ${path} and every group beneath it',
    { path: '/eng' },
  ),
  'Given to every new subject': feature(
    'roles/view/RoleRecordPage/GeneralTab.tsx',
    'label="Given to every new subject"',
  ),
  'Add a composite': feature(
    'roles/view/RoleRecordPage/CompositesTab.tsx',
    'title="Add a composite"',
  ),
  'Take it out': feature(
    'roles/view/RoleRecordPage/CompositesTab.tsx',
    'confirmLabel="Take it out"',
  ),
  'Delete reader': deleteNamed('roles/view/RoleRecordPage/GeneralTab.tsx', 'reader'),
  'admin capability': shared('service/capabilities/held.ts', "'admin capability'"),

  // Clients.
  'Delete my-app': deleteNamed('clients/view/GeneralTab/GeneralTab.tsx', 'my-app'),
  'Rotate the secret of my-app': template(
    [
      inFeature(
        'clients/view/AdvancedTab/AdvancedTab.tsx',
        '`Rotate the secret of ${client.name}`',
      ),
    ],
    'Rotate the secret of ${client.name}',
    { 'client.name': 'my-app' },
  ),
  'Rotate secret': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'confirmLabel="Rotate secret"',
  ),
  'Grace period': feature('clients/service/secret.ts', "GRACE_LABEL = 'Grace period'"),
  'Revoke every token': feature(
    'clients/service/sessions.ts',
    "REVOKE_HEADING = 'Revoke every token'",
  ),
  'Evaluate claims': feature('clients/service/evaluate.ts', "'Evaluate claims'"),

  // Scopes.
  'In the ID token': feature(SCOPE_VALUES, "'In the ID token'"),
  'In the access token': feature(SCOPE_VALUES, "'In the access token'"),
  'Consent text': feature(SCOPE_GENERAL, 'label="Consent text"'),
  'Display order': feature(SCOPE_GENERAL, 'label="Display order"'),
  'Client to assign': feature(
    'scopes/view/ScopeRecordPage/ClientsTab.tsx',
    'label="Client to assign"',
  ),
  'Assign to a client': feature(
    'scopes/view/ScopeRecordPage/ClientsTab.tsx',
    'title="Assign to a client"',
  ),
  'Bound mappers': feature('scopes/view/ScopeRecordPage/MappersTab.tsx', 'label="Bound mappers"'),
  'Delete reports:read': deleteNamed('scopes/view/ScopeRecordPage/GeneralTab.tsx', 'reports:read'),

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
  Steps: feature('flow/view/FlowPage/FlowPage.tsx', 'title="Steps"'),
  Required: feature(FLOW_REQUIREMENTS, "label: 'Required'"),
  Alternative: feature(FLOW_REQUIREMENTS, "label: 'Alternative'"),
  Conditional: feature(FLOW_REQUIREMENTS, "label: 'Conditional'"),
  Disabled: feature(FLOW_REQUIREMENTS, "label: 'Disabled'"),
  Up: feature('flow/view/FlowPage/FlowPage.tsx', '> Up <'),
  Down: feature('flow/view/FlowPage/FlowPage.tsx', '> Down <'),
  'Requirement for password': template(
    [inFeature('flow/view/FlowPage/FlowPage.tsx', '`Requirement for ${step.authenticator}`')],
    'Requirement for ${step.authenticator}',
    { 'step.authenticator': 'password' },
  ),
  'Save Steps': template(
    [
      { file: `${SHARED}/view/SaveBar/SaveBar.tsx`, text: '`${verb} ${section}`' },
      { file: `${SHARED}/view/SaveBar/SaveBar.tsx`, text: "(saveLabel ?? 'Save')" },
      inFeature('flow/view/FlowPage/FlowPage.tsx', 'title="Steps"'),
    ],
    'Save ${section}',
    { section: 'Steps' },
  ),
  Save: shared('view/SaveBar/SaveBar.tsx', "(saveLabel ?? 'Save')"),
  'One-time password': feature('flow/service/otp.ts', "OTP_TITLE = 'One-time password'"),
  'Ask every subject for a one-time password': feature(
    'flow/service/otp.ts',
    "OTP_LABEL = 'Ask every subject for a one-time password'",
  ),

  // Signing keys.
  'Stage a key': feature(KEYS_PAGE, 'title="Stage a key"'),
  'Stage key': feature(KEYS_PAGE, "'Stage key'"),
  Algorithm: feature(KEYS_PAGE, 'label="Algorithm"'),
  Rotating: feature('signing-keys/service/lanes.ts', "title: 'Rotating'"),
  Active: feature('signing-keys/service/lanes.ts', "title: 'Active'"),
  Retired: feature('signing-keys/service/lanes.ts', "title: 'Retired'"),
  Promote: feature(KEYS_PAGE, '> Promote <'),
  Retire: feature(KEYS_PAGE, '> Retire <'),
  'Promote key': feature(KEYS_CONFIRM, "confirmLabel: 'Promote key'"),
  'Retire key': feature(KEYS_CONFIRM, "confirmLabel: 'Retire key'"),
  'Delete key': feature(KEYS_CONFIRM, "confirmLabel: 'Delete key'"),
  Ready: feature('signing-keys/service/promotion.ts', "return 'Ready'"),
  'Not ready': feature('signing-keys/service/promotion.ts', "return 'Not ready'"),
  'Changes algorithm': feature('signing-keys/service/promotion.ts', "return 'Changes algorithm'"),

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
  'Clear all lockouts': feature('settings/service/lockouts.ts', "'Clear all lockouts'"),
  'Disable demo': template(
    [inFeature('tenants/view/GeneralTab/GeneralTab.tsx', 'confirmLabel={`Disable ${name}`}')],
    'Disable ${name}',
    { name: 'demo' },
  ),

  // Email.
  'Mail relay': feature('email/usecase/useRelaySection.ts', "'Mail relay'"),
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
  'Remove the relay': several(
    feature(EMAIL_PAGE, 'title="Remove the relay"'),
    feature(EMAIL_PAGE, 'confirmLabel="Remove the relay"'),
  ),
  Delivery: feature(EMAIL_MAIL, "'Delivery'"),
  Show: feature('email/view/MailDelivery/MailDelivery.tsx', 'label="Show"'),
  Refresh: feature('email/view/MailDelivery/MailDelivery.tsx', '>Refresh<'),
  Queued: feature(EMAIL_MAIL, "'Queued'"),
  Retrying: feature(EMAIL_MAIL, "'Retrying'"),
  Sent: feature(EMAIL_MAIL, "'Sent'"),
  Failed: several(feature(EMAIL_MAIL, "'Failed'"), feature(AUDIT_KINDS, "'Failed'")),
  'not sent': feature('email/service/effective.ts', "return 'not sent'"),
  'deployment sender': feature('email/service/effective.ts', "return 'deployment sender'"),
  'own relay': feature('email/service/effective.ts', "return 'own relay'"),

  // Branding.
  Theme: tab('branding', 'theme', 'Theme'),
  Pages: tab('branding', 'pages', 'Pages'),
  Mail: tab('branding', 'mail', 'Mail'),
  Languages: tab('branding', 'languages', 'Languages'),
  'What the mail inherits': several(
    feature('branding/service/mail.ts', "MAIL_INHERITS_TITLE = 'What the mail inherits'"),
    feature('branding/view/MailTab/MailTab.tsx', '{MAIL_INHERITS_TITLE}'),
  ),
  'Preview as client': feature('branding/service/mail.ts', "MAIL_AS_LABEL = 'Preview as client'"),
  'Show the tenant’s own': feature(
    'branding/service/mail.ts',
    "MAIL_TENANT_OWN = 'Show the tenant’s own'",
  ),
  'Message background': feature('branding/service/mail.ts', "label: 'Message background'"),
  'Link box background': feature('branding/service/mail.ts', "label: 'Link box background'"),
  'Quiet text': feature('branding/service/mail.ts', "label: 'Quiet text'"),
  'Button text': feature('branding/service/mail.ts', "label: 'Button text'"),
  'Supported languages': feature(
    'branding/service/languages.ts',
    "SUPPORTED_LABEL = 'Supported languages'",
  ),
  'Default language': feature(
    'branding/service/languages.ts',
    "DEFAULT_LABEL = 'Default language'",
  ),
  'Message overrides': feature(
    'branding/service/overrides.ts',
    "OVERRIDES_TITLE = 'Message overrides'",
  ),
  Edit: feature('branding/view/LanguagesTab/LanguagesTab.tsx', '> Edit </Button>'),
  Remove: feature('branding/view/LanguagesTab/LanguagesTab.tsx', '> Remove </Button>'),
  'Colours and font': feature('branding/service/fields.ts', "COLOURS_TITLE = 'Colours and font'"),
  'Use my own light colours': template(
    [inFeature('branding/service/copy.ts', 'Use my own ${scheme} colours')],
    'Use my own ${scheme} colours',
    { scheme: 'light' },
  ),
  Images: feature('branding/service/fields.ts', "IMAGES_TITLE = 'Images'"),
  Stylesheet: feature('branding/service/fields.ts', "STYLESHEET_SECTION_TITLE = 'Stylesheet'"),
  Contrast: feature('branding/service/copy.ts', "CONTRAST_TITLE = 'Contrast'"),
  Publish: feature('branding/service/publish.ts', "PUBLISH_TITLE = 'Publish'"),
  Versions: feature('branding/service/versions.ts', "VERSIONS_TITLE = 'Versions'"),
  'Reset to default': feature('branding/service/versions.ts', "RESET_TITLE = 'Reset to default'"),
  'Revert to published': feature(
    'branding/service/publication.ts',
    "REVERT_TITLE = 'Revert to published'",
  ),
  'Revert this tab to published': feature(
    'branding/service/publication.ts',
    "REVERT_LABEL = 'Revert this tab to published'",
  ),
  'Discard draft': feature('branding/service/publication.ts', "DISCARD_CONFIRM = 'Discard draft'"),
  'Delete image': feature('branding/service/copy.ts', "DELETE_LABEL = 'Delete image'"),
  Preview: feature('branding/service/preview.ts', "PREVIEW_TITLE = 'Preview'"),
  'Message key': feature('branding/service/overrides.ts', "KEY_LABEL = 'Message key'"),
  'Add language': feature('branding/service/languages.ts', "ADD_BUTTON = 'Add language'"),
  'Insert a message': feature('branding/service/catalogue.ts', "INSERT_LABEL = 'Insert a message'"),
  'Selectors you can use': feature(
    'branding/service/selectors.ts',
    "SELECTORS_LABEL = 'Selectors you can use'",
  ),
  'Design values you can use': feature(
    'branding/service/selectors.ts',
    "VALUES_LABEL = 'Design values you can use'",
  ),
  Translations: feature('clients/service/labels.ts', "translations: 'Translations'"),
  'Description by language': feature(
    'scopes/service/general.ts',
    "DESCRIPTION_LANGUAGES_LABEL = 'Description by language'",
  ),
  'Consent text by language': feature(
    'scopes/service/general.ts',
    "CONSENT_LANGUAGES_LABEL = 'Consent text by language'",
  ),

  // The audit trail.
  'Event type': feature(FILTERS, 'label="Event type"'),
  Outcome: feature(FILTERS, 'label="Outcome"'),
  Action: feature(FILTERS, 'label="Action"'),
  'Resource type': feature(FILTERS, 'label="Resource type"'),
  'Resource id': feature(FILTERS, 'label="Resource id"'),
  'Actor (subject id)': feature(FILTERS, 'label="Actor (subject id)"'),
  From: feature(FILTERS, 'label="From"'),
  To: feature(FILTERS, 'label="To"'),
  'Apply filters': feature(FILTERS, '> Apply filters <'),
  'Admin change': feature(AUDIT_KINDS, "'Admin change'"),
  'Admin access': feature(AUDIT_KINDS, "'Admin access'"),
  Authentication: feature(AUDIT_KINDS, "'Authentication'"),
  Session: feature(AUDIT_KINDS, "'Session'"),
  Token: feature(AUDIT_KINDS, "'Token'"),
  Credential: feature(AUDIT_KINDS, "'Credential'"),
  Allowed: feature(AUDIT_KINDS, "'Allowed'"),
  Refused: feature(AUDIT_KINDS, "'Refused'"),
  Details: shared('view/AuditTable/AuditTable.tsx', '> Details <'),
  'Export these events': feature('audit/view/AuditPage/AuditPage.tsx', "'Export these events'"),

  // The overview.
  'Needs attention': feature(
    'overview/view/AttentionPanel/AttentionPanel.tsx',
    'title="Needs attention"',
  ),
  Counts: feature('overview/view/CountsPanel/CountsPanel.tsx', 'title="Counts"'),
  Discovery: feature('overview/view/DiscoveryPanel/DiscoveryPanel.tsx', 'title="Discovery"'),
  Issuer: feature('overview/view/DiscoveryPanel/DiscoveryPanel.tsx', '>Issuer<'),
  'Latest activity': feature(
    'overview/view/LatestAudit/LatestAudit.tsx',
    'title="Latest activity"',
  ),
  'Open the audit trail': feature(
    'overview/view/LatestAudit/LatestAudit.tsx',
    '> Open the audit trail <',
  ),

  // Tenants and their administrators.
  'Export to a file': feature('tenants/view/ExportPanel/ExportPanel.tsx', "'Export to a file'"),
  'Include subjects': feature(
    'tenants/view/ExportPanel/ExportPanel.tsx',
    'label="Include subjects"',
  ),
  Import: feature(TENANT_IMPORT, "'Import'"),
  'Choose a file…': feature(TENANT_IMPORT, '> Choose a file… <'),
  'Tenant document': feature(TENANT_IMPORT, '> Tenant document <'),
  'Add an administrator': several(
    feature(SYSTEM_PAGE, '> Add an administrator <'),
    feature('tenants/view/AdministratorsTab/AdministratorsTab.tsx', '>Add an administrator<'),
  ),
  'Subject in system': feature(SYSTEM_PAGE, 'label="Subject in system"'),
  'What they hold': several(
    feature(SYSTEM_PAGE, 'label="What they hold"'),
    feature(TENANT_NEW, 'label="What they hold"'),
  ),
  'Give it to the chosen subject': feature(SYSTEM_PAGE, "'Give it to the chosen subject'"),
  'Full (tenant-admin)': at(`${SHARED}/service/capabilities/holdings.ts`, "'Full (tenant-admin)'"),
  'Change admin@odudu.local’s capabilities': template(
    [
      inFeature(
        'subjects/view/CapabilityHolders/CapabilityHolders.tsx',
        '`Change ${holder.name}’s capabilities`',
      ),
    ],
    'Change ${holder.name}’s capabilities',
    { 'holder.name': 'admin@odudu.local' },
  ),
  Availability: feature('clients/service/labels.ts', "'Availability'"),
  'Consent required': feature('clients/view/GeneralTab/GeneralTab.tsx', 'label="Consent required"'),
  'Consent screen links': feature('clients/service/labels.ts', "'Consent screen links'"),
  'Home page': feature('clients/view/GeneralTab/GeneralTab.tsx', 'label="Home page"'),
  'Privacy policy': feature('clients/view/GeneralTab/GeneralTab.tsx', 'label="Privacy policy"'),
  'Terms of service': feature('clients/view/GeneralTab/GeneralTab.tsx', 'label="Terms of service"'),
  'Client credentials scopes': feature(
    'clients/view/TokensTab/TokensTab.tsx',
    'label="Client credentials scopes"',
  ),
  'ID token claims': feature('clients/service/evaluate.ts', "label: 'ID token claims'"),
  'Access token claims': feature('clients/service/evaluate.ts', "label: 'Access token claims'"),
  'UserInfo claims': feature('clients/service/evaluate.ts', "label: 'UserInfo claims'"),
  'Skip the sign-out confirmation': feature(
    'clients/service/logout.ts',
    "SKIP_LOGOUT_LABEL = 'Skip the sign-out confirmation'",
  ),
  'Back-channel logout address': feature(
    'clients/view/LogoutTab/LogoutTab.tsx',
    'label="Back-channel logout address"',
  ),
  'Front-channel logout address': feature(
    'clients/view/LogoutTab/LogoutTab.tsx',
    'label="Front-channel logout address"',
  ),
  Installation: feature('clients/service/installation.ts', "'Installation'"),
  'Discovery URL': feature('clients/service/installation.ts', "label: 'Discovery URL'"),
  'Client type': feature('clients/service/installation.ts', "label: 'Client type'"),
  'Authentication method': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'label="Authentication method"',
  ),
  'Certificate subject': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'label="Certificate subject"',
  ),
  'Key source': feature('clients/view/AdvancedTab/AdvancedTab.tsx', 'label="Key source"'),
  'None published': feature('clients/service/advanced.ts', "label: 'None published'"),
  'A JWKS URI': feature('clients/service/advanced.ts', "label: 'A JWKS URI'"),
  'A key set pasted here': feature('clients/service/advanced.ts', "label: 'A key set pasted here'"),
  'Signing algorithm': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'label="Signing algorithm"',
  ),
  'Plain JSON, not signed': feature(
    'clients/service/advanced.ts',
    "label: 'Plain JSON, not signed'",
  ),
  'Encryption algorithm': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'label="Encryption algorithm"',
  ),
  'Not encrypted': feature('clients/service/advanced.ts', "label: 'Not encrypted'"),
  'Content encryption': feature(
    'clients/view/AdvancedTab/AdvancedTab.tsx',
    'label="Content encryption"',
  ),
  'Response type': feature('clients/service/advanced.ts', "label: 'Response type'"),
  Audiences: feature('clients/view/AdvancedTab/AdvancedTab.tsx', 'label="Audiences"'),
  'Allow impersonation in token exchange': feature(
    'clients/service/advanced.ts',
    "'Allow impersonation in token exchange'",
  ),
  'New subjects': feature('roles/usecase/useRoleGeneral.ts', "label: 'New subjects'"),
  'Tenant or client': feature('roles/view/RolesPage/RolesPage.tsx', "label: 'Tenant or client'"),
  'New clients': feature('scopes/usecase/useScopeGeneral.ts', "label: 'New clients'"),
  'Assigned as default': feature('scopes/service/general.ts', "label: 'Assigned as default'"),
  'Assigned as optional': feature('scopes/service/general.ts', "label: 'Assigned as optional'"),
  'Not assigned': feature('scopes/service/general.ts', "label: 'Not assigned'"),
  'Sessions per browser': feature(
    'settings/service/accessSections.ts',
    "label: 'Sessions per browser'",
  ),
  'Time to finish a sign-in': feature(
    'settings/service/accessSections.ts',
    "label: 'Time to finish a sign-in'",
  ),
  'Offer remember me': feature('settings/service/accessSections.ts', "label: 'Offer remember me'"),
  'Verification link lifetime': feature(
    'settings/service/accessSections.ts',
    "label: 'Verification link lifetime'",
  ),
  'Password reset by mail': feature(
    'settings/service/accessSections.ts',
    "label: 'Password reset by mail'",
  ),
  'Reset link lifetime': feature(
    'settings/service/accessSections.ts',
    "label: 'Reset link lifetime'",
  ),
  'Usernames can be renamed': feature(
    'settings/service/accessSections.ts',
    "label: 'Usernames can be renamed'",
  ),
  'Sign in with a verified email address': feature(
    'settings/service/accessSections.ts',
    "label: 'Sign in with a verified email address'",
  ),
  'Require a digit': feature('settings/service/accessSections.ts', "label: 'Require a digit'"),
  'Require an uppercase letter': feature(
    'settings/service/accessSections.ts',
    "label: 'Require an uppercase letter'",
  ),
  'Require a lowercase letter': feature(
    'settings/service/accessSections.ts',
    "label: 'Require a lowercase letter'",
  ),
  'Require a special character': feature(
    'settings/service/accessSections.ts',
    "label: 'Require a special character'",
  ),
  'Refuse the username': feature(
    'settings/service/accessSections.ts',
    "label: 'Refuse the username'",
  ),
  'Refuse the email address': feature(
    'settings/service/accessSections.ts',
    "label: 'Refuse the email address'",
  ),
  'Passwords remembered': feature(
    'settings/service/accessSections.ts',
    "label: 'Passwords remembered'",
  ),
  'First lockout': feature('settings/service/accessSections.ts', "label: 'First lockout'"),
  'Longest lockout': feature('settings/service/accessSections.ts', "label: 'Longest lockout'"),
  'Failures forgotten after': feature(
    'settings/service/accessSections.ts',
    "label: 'Failures forgotten after'",
  ),
  'Access token': feature('settings/service/platformSections.ts', "label: 'Access token'"),
  'ID token': feature('settings/service/platformSections.ts', "label: 'ID token'"),
  'Refresh token': feature('settings/service/platformSections.ts', "label: 'Refresh token'"),
  'Authorization code': feature(
    'settings/service/platformSections.ts',
    "label: 'Authorization code'",
  ),
  'Open: any application may register': feature(
    'settings/service/platformSections.ts',
    "label: 'Open: any application may register'",
  ),
  'Most clients': feature('settings/service/platformSections.ts', "label: 'Most clients'"),
  'Events recorded': feature('settings/service/platformSections.ts', "label: 'Events recorded'"),
  'Changes by administrators': feature(
    'settings/service/platformSections.ts',
    "label: 'Changes by administrators'",
  ),
  'Reads by administrators': feature(
    'settings/service/platformSections.ts',
    "label: 'Reads by administrators'",
  ),
  'Sign-ins and refused sign-ins': feature(
    'settings/service/platformSections.ts',
    "label: 'Sign-ins and refused sign-ins'",
  ),
  'Sessions starting and ending': feature(
    'settings/service/platformSections.ts',
    "label: 'Sessions starting and ending'",
  ),
  'Tokens issued and revoked': feature(
    'settings/service/platformSections.ts',
    "label: 'Tokens issued and revoked'",
  ),
  'Passwords, keys and codes set or changed': feature(
    'settings/service/platformSections.ts',
    "label: 'Passwords, keys and codes set or changed'",
  ),
  'Add a step': feature('flow/view/FlowPage/FlowPage.tsx', 'label="Add a step"'),
  'Requirement of the new step': feature(
    'flow/view/FlowPage/FlowPage.tsx',
    'label="Requirement of the new step"',
  ),
  'ES256 (elliptic curve)': feature(
    'signing-keys/service/stage.ts',
    "label: 'ES256 (elliptic curve)'",
  ),
  'RS256 (RSA)': feature('signing-keys/service/stage.ts', "label: 'RS256 (RSA)'"),
  'Holding anything or nothing': feature(
    'subjects/view/SubjectsPage/SubjectsPage.tsx',
    "label: 'Holding anything or nothing'",
  ),
  'Given name': feature('subjects/service/claims.ts', "label: 'Given name'"),
  'Family name': feature('subjects/service/claims.ts', "label: 'Family name'"),
  'Middle name': feature('subjects/service/claims.ts', "label: 'Middle name'"),
  'Preferred username': feature('subjects/service/claims.ts', "label: 'Preferred username'"),
  'Phone number verified': feature(
    'subjects/view/SubjectRecordPage/ProfileTab.tsx',
    'label="Phone number verified"',
  ),
  Locality: feature('subjects/service/claims.ts', "label: 'Locality'"),
  Region: feature('subjects/service/claims.ts', "label: 'Region'"),
  'Postal code': feature('subjects/service/claims.ts', "label: 'Postal code'"),
  'Ask for a new set at next sign-in': feature(
    'subjects/service/credentials.ts',
    "label: 'Ask for a new set at next sign-in'",
  ),
  'Choose a new password': feature('subjects/service/actions.ts', "label: 'Choose a new password'"),
  'Set up an authenticator app': feature(
    'subjects/service/actions.ts',
    "label: 'Set up an authenticator app'",
  ),
  'Register a passkey': feature('subjects/service/actions.ts', "label: 'Register a passkey'"),
  'Generate recovery codes': feature(
    'subjects/service/actions.ts',
    "label: 'Generate recovery codes'",
  ),
  'Required actions to email': feature(
    'subjects/view/SubjectRecordPage/CredentialsTab.tsx',
    'label="Required actions to email"',
  ),
  'Filter administrators': feature(
    'subjects/view/CapabilityHolders/CapabilityHolders.tsx',
    'label="Filter administrators"',
  ),
  'Which tenant do you administer?': feature(
    'session/view/SignIn/SignIn.tsx',
    'label="Which tenant do you administer?"',
  ),
  Consent: feature('clients/service/labels.ts', "consent: 'Consent'"),
  'Full name': feature('subjects/service/claims.ts', "label: 'Full name'"),
  Nickname: feature('subjects/service/claims.ts', "label: 'Nickname'"),
  Gender: feature('subjects/service/claims.ts', "label: 'Gender'"),
  Birthdate: feature('subjects/service/claims.ts', "label: 'Birthdate'"),
  'Time zone': feature('subjects/service/claims.ts', "label: 'Time zone'"),
  Locale: feature('subjects/service/claims.ts', "label: 'Locale'"),
  'Profile page': feature('subjects/service/claims.ts', "label: 'Profile page'"),
  Website: feature('subjects/service/claims.ts', "label: 'Website'"),
  Picture: feature('subjects/service/claims.ts', "label: 'Picture'"),
  'Phone number': feature('subjects/service/claims.ts', "label: 'Phone number'"),
  'Formatted address': feature('subjects/service/claims.ts', "label: 'Formatted address'"),
  Street: feature('subjects/service/claims.ts', "label: 'Street'"),
  Country: feature('subjects/service/claims.ts', "label: 'Country'"),
};
