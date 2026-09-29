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

function tenantsPage(name: 'TenantsPage' | 'NewTenantPage' | 'ImportTenantPage' | 'ExportPage') {
  return lazyFeatureRoute(
    () => import('#/features/tenants/index.ts').then((feature) => feature[name]),
    'Loading tenants',
  );
}

const Tenants = tenantsPage('TenantsPage');
const NewTenant = tenantsPage('NewTenantPage');
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

const TAKEN = new Set(['tenants', 'export', 'system-admins']);

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
  tenant.addChildren([overview, ...tenantPages, systemAdmins, ...areas]),
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
