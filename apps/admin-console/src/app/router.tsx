import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { lazyFeatureRoute } from '#/app/lazyFeatureRoute.tsx';
import { NavigationGuard } from '#/app/NavigationGuard.tsx';
import { ConsoleHome, SessionGate } from '#/features/session/index.ts';
import {
  AreaPage,
  EVERY_AREA,
  OVERVIEW,
  PageNotFound,
  TenantShell,
} from '#/features/shell/index.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';

// React Aria's links navigate through the router, so a rail link is still a
// real href for a new tab while an ordinary click waits on the guard.
function Root() {
  const router = useRouter();
  return (
    <AriaRouterProvider
      navigate={(href) => {
        router.navigate({ href }).catch(() => undefined);
      }}
    >
      <NavigationGuard />
      <SessionGate>
        <Outlet />
      </SessionGate>
    </AriaRouterProvider>
  );
}

function Lost() {
  return (
    <main id="main" tabIndex={-1}>
      <PageNotFound />
    </main>
  );
}

const root = createRootRoute({ component: Root, notFoundComponent: Lost });

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
});

const Overview = lazyFeatureRoute(
  () => import('#/features/overview/index.ts').then((feature) => feature.OverviewPage),
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
    () => import('#/features/tenants/index.ts').then((feature) => feature[name]),
    'Loading tenants',
  );
}

const Tenants = tenantsPage('TenantsPage');
const NewTenant = tenantsPage('NewTenantPage');
const NewSystemAdministrator = tenantsPage('NewSystemAdministratorPage');
const NewAdministrator = lazyFeatureRoute(
  () => import('#/features/tenants/index.ts').then((feature) => feature.NewAdministratorPage),
  'Loading tenants',
);
const ImportTenant = tenantsPage('ImportTenantPage');
const Export = tenantsPage('ExportPage');
const TenantRecord = lazyFeatureRoute(
  () => import('#/features/tenants/index.ts').then((feature) => feature.TenantRecordPage),
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
  () =>
    import('#/features/system-admins/index.ts').then((feature) => feature.SystemAdministratorsPage),
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
    () => import('#/features/subjects/index.ts').then((feature) => feature[name]),
    'Loading subjects',
  );
}

const Subjects = subjectsPage('SubjectsPage');
const NewSubject = subjectsPage('NewSubjectPage');
const SubjectRecord = lazyFeatureRoute(
  () => import('#/features/subjects/index.ts').then((feature) => feature.SubjectRecordPage),
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
    () => import('#/features/groups/index.ts').then((feature) => feature[name]),
    'Loading groups',
  );
}

const Groups = groupsPage('GroupsPage');
const NewGroup = groupsPage('NewGroupPage');
const GroupRecord = lazyFeatureRoute(
  () => import('#/features/groups/index.ts').then((feature) => feature.GroupRecordPage),
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
  ];
  return Promise.all(features.map((feature) => feature.preload())).then(() => undefined);
}

const TAKEN = new Set(['tenants', 'export', 'system-admins', 'subjects', 'groups']);

const areas = EVERY_AREA.filter((area) => area !== OVERVIEW && !TAKEN.has(area.path)).map((area) =>
  createRoute({
    getParentRoute: () => tenant,
    path: area.path,
    component: function Area() {
      const { tenant: name } = tenant.useParams();
      return <AreaPage key={`${name}/${area.path}`} tenant={name} area={area} />;
    },
  }),
);

const routeTree = root.addChildren([
  home,
  tenant.addChildren([
    overview,
    ...tenantPages,
    systemAdmins,
    newSystemAdmin,
    ...subjectPages,
    ...groupPages,
    ...areas,
  ]),
]);

export function createConsoleRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({
    routeTree,
    basepath: '/console',
    history,
    parseSearch,
    stringifySearch,
  });
}

export type ConsoleRouter = ReturnType<typeof createConsoleRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: ConsoleRouter;
  }
}
