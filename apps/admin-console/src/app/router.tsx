import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useLocation,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { lazyFeatureRoute } from '#/app/lazyFeatureRoute';
import { NavigationGuard } from '#/app/NavigationGuard';
import { RouteFailure, ShellFailure } from '#/features/failure';
import { ConsoleHome, SessionGate } from '#/features/session';
import { pendingPage, PendingFrame, TenantShell } from '#/features/shell';
import { PRODUCT_NAME } from '#/shared/service/product';
import { parseSearch, stringifySearch } from '#/shared/service/search';
import { LostFrame } from '#/shared/view/LostFrame';
import { PageNotFound } from '#/shared/view/PageNotFound';

// React Aria's links navigate through the router, so a rail link is still a
// real href for a new tab while an ordinary click waits on the guard.
function Root() {
  const router = useRouter();
  const page = pendingPage(useLocation().pathname);
  return (
    <AriaRouterProvider
      navigate={(href) => {
        router.navigate({ href }).catch(() => undefined);
      }}
    >
      <NavigationGuard />
      <SessionGate pending={page === null ? undefined : <PendingFrame {...page} />}>
        <Outlet />
      </SessionGate>
    </AriaRouterProvider>
  );
}

function Lost() {
  return (
    <LostFrame brand={PRODUCT_NAME}>
      <PageNotFound />
    </LostFrame>
  );
}

// A failure inside a page leaves the shell standing; the root and tenant
// routes are what draw the shell, so a failure in either has none to leave.
const root = createRootRoute({
  component: Root,
  notFoundComponent: Lost,
  errorComponent: ShellFailure,
});

const home = createRoute({ getParentRoute: () => root, path: '/', component: ConsoleHome });

const tenant = createRoute({
  getParentRoute: () => root,
  path: '$tenant',
  component: function Tenant() {
    const { tenant: name } = tenant.useParams();
    return (
      <TenantShell tenant={name}>
        <Outlet />
      </TenantShell>
    );
  },
  notFoundComponent: PageNotFound,
  errorComponent: ShellFailure,
});

const Overview = lazyFeatureRoute(
  () => import('#/features/overview').then((feature) => feature.OverviewPage),
  'Loading the overview',
);

const overview = createRoute({
  getParentRoute: () => tenant,
  path: '/',
  component: function TenantOverview() {
    const { tenant: name } = tenant.useParams();
    return <Overview key={name} tenant={name} />;
  },
});

function tenantsPage(
  name:
    | 'TenantsPage'
    | 'NewTenantPage'
    | 'NewSystemAdministratorPage'
    | 'ImportTenantPage'
    | 'ExportPage',
) {
  return lazyFeatureRoute(
    () => import('#/features/tenants').then((feature) => feature[name]),
    'Loading tenants',
  );
}

const Tenants = tenantsPage('TenantsPage');
const NewTenant = tenantsPage('NewTenantPage');
const NewSystemAdministrator = tenantsPage('NewSystemAdministratorPage');
const NewAdministrator = lazyFeatureRoute(
  () => import('#/features/tenants').then((feature) => feature.NewAdministratorPage),
  'Loading tenants',
);
const ImportTenant = tenantsPage('ImportTenantPage');
const Export = tenantsPage('ExportPage');
const TenantRecord = lazyFeatureRoute(
  () => import('#/features/tenants').then((feature) => feature.TenantRecordPage),
  'Loading the tenant',
);

// The System area's tenant pages, and a tenant's own export.
const tenantPages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'tenants',
    component: function TenantList() {
      const { tenant: name } = tenant.useParams();
      return <Tenants key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'tenants/$name',
    component: function TenantAtName() {
      const { tenant: name } = tenant.useParams();
      const { name: record } = tenantRecord.useParams();
      return <TenantRecord key={`${name}/${record}`} tenant={name} name={record} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'tenants/$name/new-administrator',
    component: function AdministratorCreation() {
      const { tenant: name } = tenant.useParams();
      const { name: record } = tenantAdministrator.useParams();
      return <NewAdministrator key={`${name}/${record}`} tenant={name} name={record} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'new-tenant',
    component: function TenantCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewTenant key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'import-tenant',
    component: function TenantImport() {
      const { tenant: name } = tenant.useParams();
      return <ImportTenant key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'export',
    component: function TenantExport() {
      const { tenant: name } = tenant.useParams();
      return <Export key={name} tenant={name} />;
    },
  }),
] as const;
const tenantRecord = tenantPages[1];
const tenantAdministrator = tenantPages[2];

const SystemAdministrators = lazyFeatureRoute(
  () => import('#/features/system-admins').then((feature) => feature.SystemAdministratorsPage),
  'Loading system administrators',
);

const systemAdmins = createRoute({
  getParentRoute: () => tenant,
  path: 'system-admins',
  component: function SystemAdmins() {
    const { tenant: name } = tenant.useParams();
    return <SystemAdministrators key={name} tenant={name} />;
  },
});

const newSystemAdmin = createRoute({
  getParentRoute: () => tenant,
  path: 'system-admins/new',
  component: function SystemAdminCreation() {
    const { tenant: name } = tenant.useParams();
    return <NewSystemAdministrator key={name} tenant={name} />;
  },
});

function subjectsPage(name: 'SubjectsPage' | 'NewSubjectPage') {
  return lazyFeatureRoute(
    () => import('#/features/subjects').then((feature) => feature[name]),
    'Loading subjects',
  );
}

const Subjects = subjectsPage('SubjectsPage');
const NewSubject = subjectsPage('NewSubjectPage');
const SubjectRecord = lazyFeatureRoute(
  () => import('#/features/subjects').then((feature) => feature.SubjectRecordPage),
  'Loading the subject',
);

const subjectPages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'subjects',
    component: function SubjectList() {
      const { tenant: name } = tenant.useParams();
      return <Subjects key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'subjects/new',
    component: function SubjectCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewSubject key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'subjects/$id',
    component: function SubjectAtId() {
      const { tenant: name } = tenant.useParams();
      const { id } = subjectRecord.useParams();
      return <SubjectRecord key={`${name}/${id}`} tenant={name} id={id} />;
    },
  }),
] as const;
const subjectRecord = subjectPages[2];

function groupsPage(name: 'GroupsPage' | 'NewGroupPage') {
  return lazyFeatureRoute(
    () => import('#/features/groups').then((feature) => feature[name]),
    'Loading groups',
  );
}

const Groups = groupsPage('GroupsPage');
const NewGroup = groupsPage('NewGroupPage');
const GroupRecord = lazyFeatureRoute(
  () => import('#/features/groups').then((feature) => feature.GroupRecordPage),
  'Loading the group',
);

const groupPages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'groups',
    component: function GroupList() {
      const { tenant: name } = tenant.useParams();
      return <Groups key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'groups/new',
    component: function GroupCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewGroup key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'groups/$id',
    component: function GroupAtId() {
      const { tenant: name } = tenant.useParams();
      const { id } = groupRecord.useParams();
      return <GroupRecord key={`${name}/${id}`} tenant={name} id={id} />;
    },
  }),
] as const;
const groupRecord = groupPages[2];

function rolesPage(name: 'RolesPage' | 'NewRolePage') {
  return lazyFeatureRoute(
    () => import('#/features/roles').then((feature) => feature[name]),
    'Loading roles',
  );
}

const Roles = rolesPage('RolesPage');
const NewRole = rolesPage('NewRolePage');
const RoleRecord = lazyFeatureRoute(
  () => import('#/features/roles').then((feature) => feature.RoleRecordPage),
  'Loading the role',
);

const rolePages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'roles',
    component: function RoleList() {
      const { tenant: name } = tenant.useParams();
      return <Roles key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'roles/new',
    component: function RoleCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewRole key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'roles/$id',
    component: function RoleAtId() {
      const { tenant: name } = tenant.useParams();
      const { id } = roleRecord.useParams();
      return <RoleRecord key={`${name}/${id}`} tenant={name} id={id} />;
    },
  }),
] as const;
const roleRecord = rolePages[2];

function clientsPage(name: 'ClientsPage' | 'NewClientPage') {
  return lazyFeatureRoute(
    () => import('#/features/clients').then((feature) => feature[name]),
    'Loading clients',
  );
}

const Clients = clientsPage('ClientsPage');
const NewClient = clientsPage('NewClientPage');
const ClientRecord = lazyFeatureRoute(
  () => import('#/features/clients').then((feature) => feature.ClientRecordPage),
  'Loading the client',
);

const clientPages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'clients',
    component: function ClientList() {
      const { tenant: name } = tenant.useParams();
      return <Clients key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'clients/new',
    component: function ClientCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewClient key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'clients/$id',
    component: function ClientAtId() {
      const { tenant: name } = tenant.useParams();
      const { id } = clientRecord.useParams();
      return <ClientRecord key={`${name}/${id}`} tenant={name} id={id} />;
    },
  }),
] as const;
const clientRecord = clientPages[2];

function scopesPage(name: 'ScopesPage' | 'NewScopePage') {
  return lazyFeatureRoute(
    () => import('#/features/scopes').then((feature) => feature[name]),
    'Loading scopes',
  );
}

const Scopes = scopesPage('ScopesPage');
const NewScope = scopesPage('NewScopePage');
const ScopeRecord = lazyFeatureRoute(
  () => import('#/features/scopes').then((feature) => feature.ScopeRecordPage),
  'Loading the scope',
);

const scopePages = [
  createRoute({
    getParentRoute: () => tenant,
    path: 'scopes',
    component: function ScopeList() {
      const { tenant: name } = tenant.useParams();
      return <Scopes key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'scopes/new',
    component: function ScopeCreation() {
      const { tenant: name } = tenant.useParams();
      return <NewScope key={name} tenant={name} />;
    },
  }),
  createRoute({
    getParentRoute: () => tenant,
    path: 'scopes/$id',
    component: function ScopeAtId() {
      const { tenant: name } = tenant.useParams();
      const { id } = scopeRecord.useParams();
      return <ScopeRecord key={`${name}/${id}`} tenant={name} id={id} />;
    },
  }),
] as const;
const scopeRecord = scopePages[2];

const RegistrationTokens = lazyFeatureRoute(
  () => import('#/features/registration-tokens').then((feature) => feature.RegistrationTokensPage),
  'Loading registration tokens',
);

const registrationTokens = createRoute({
  getParentRoute: () => tenant,
  path: 'registration-tokens',
  component: function RegistrationTokenList() {
    const { tenant: name } = tenant.useParams();
    return <RegistrationTokens key={name} tenant={name} />;
  },
});

const Flow = lazyFeatureRoute(
  () => import('#/features/flow').then((feature) => feature.FlowPage),
  'Loading the sign-in flow',
);

const flow = createRoute({
  getParentRoute: () => tenant,
  path: 'flow',
  component: function SignInFlow() {
    const { tenant: name } = tenant.useParams();
    return <Flow key={name} tenant={name} />;
  },
});

const SigningKeys = lazyFeatureRoute(
  () => import('#/features/signing-keys').then((feature) => feature.SigningKeysPage),
  'Loading signing keys',
);

const signingKeys = createRoute({
  getParentRoute: () => tenant,
  path: 'keys',
  component: function SigningKeysList() {
    const { tenant: name } = tenant.useParams();
    return <SigningKeys key={name} tenant={name} />;
  },
});

const TenantSessions = lazyFeatureRoute(
  () => import('#/features/tenant-sessions').then((feature) => feature.TenantSessionsPage),
  'Loading sessions',
);

const tenantSessions = createRoute({
  getParentRoute: () => tenant,
  path: 'sessions',
  component: function TenantSessionList() {
    const { tenant: name } = tenant.useParams();
    return <TenantSessions key={name} tenant={name} />;
  },
});

const Settings = lazyFeatureRoute(
  () => import('#/features/settings').then((feature) => feature.SettingsPage),
  'Loading the settings',
);

const settings = createRoute({
  getParentRoute: () => tenant,
  path: 'settings',
  component: function TenantSettings() {
    const { tenant: name } = tenant.useParams();
    return <Settings key={name} tenant={name} />;
  },
});

const Email = lazyFeatureRoute(
  () => import('#/features/email').then((feature) => feature.EmailPage),
  'Loading email',
);

const email = createRoute({
  getParentRoute: () => tenant,
  path: 'email',
  component: function TenantEmail() {
    const { tenant: name } = tenant.useParams();
    return <Email key={name} tenant={name} />;
  },
});

const Branding = lazyFeatureRoute(
  () => import('#/features/branding').then((feature) => feature.BrandingPage),
  'Loading branding',
);

const branding = createRoute({
  getParentRoute: () => tenant,
  path: 'branding',
  component: function TenantBranding() {
    const { tenant: name } = tenant.useParams();
    return <Branding key={name} tenant={name} />;
  },
});

const Audit = lazyFeatureRoute(
  () => import('#/features/audit').then((feature) => feature.AuditPage),
  'Loading the audit trail',
);

const audit = createRoute({
  getParentRoute: () => tenant,
  path: 'audit',
  component: function TenantAudit() {
    const { tenant: name } = tenant.useParams();
    return <Audit key={name} tenant={name} />;
  },
});

// Every feature chunk the routes load, for a caller that wants them all in
// hand before the first render.
export function preloadFeatures(): Promise<void> {
  const features = [
    Overview,
    Tenants,
    NewTenant,
    NewSystemAdministrator,
    ImportTenant,
    Export,
    TenantRecord,
    SystemAdministrators,
    Subjects,
    NewSubject,
    SubjectRecord,
    Groups,
    NewGroup,
    GroupRecord,
    Roles,
    NewRole,
    RoleRecord,
    Clients,
    NewClient,
    ClientRecord,
    Scopes,
    NewScope,
    ScopeRecord,
    RegistrationTokens,
    Flow,
    SigningKeys,
    TenantSessions,
    Settings,
    Branding,
    Email,
    Audit,
  ];
  return Promise.all(features.map((feature) => feature.preload())).then(() => undefined);
}

const routeTree = root.addChildren([
  home,
  tenant.addChildren([
    overview,
    ...tenantPages,
    systemAdmins,
    newSystemAdmin,
    ...subjectPages,
    ...groupPages,
    ...rolePages,
    ...clientPages,
    ...scopePages,
    registrationTokens,
    flow,
    signingKeys,
    tenantSessions,
    settings,
    branding,
    email,
    audit,
  ]),
]);

export function createConsoleRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({
    routeTree,
    basepath: '/console',
    history,
    parseSearch,
    stringifySearch,
    defaultErrorComponent: RouteFailure,
    // The router's own boundary around the root match draws an unbranded
    // panel; without it a failure there reaches the console's root fallback.
    disableGlobalCatchBoundary: true,
  });
}

export type ConsoleRouter = ReturnType<typeof createConsoleRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: ConsoleRouter;
  }
}
