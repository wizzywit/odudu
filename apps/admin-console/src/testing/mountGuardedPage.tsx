import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type RouteComponent,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { NavigationGuard } from '#/app/NavigationGuard';
import { Providers } from '#/app/Providers';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer';
import { SessionGate } from '#/features/session';
import { TenantShell } from '#/features/shell';
import { createQueryClient } from '#/shared/repository/queryClient';
import { parseSearch, stringifySearch } from '#/shared/services/search';
import { fakeTransport, type Answer } from '#/testing/fakeTransport';

// A section on acme's client c1, inside the session gate, the tenant shell and
// the unsaved-changes guard, without the rest of the console.
export function mountGuardedPage(routes: Record<string, Answer>, page: RouteComponent) {
  const fake = fakeTransport(routes);
  const root = createRootRoute({
    component: () => (
      <>
        <NavigationGuard />
        <SessionGate>
          <Outlet />
        </SessionGate>
      </>
    ),
  });
  const tenant = createRoute({
    getParentRoute: () => root,
    path: '$tenant',
    component: function Tenant() {
      return (
        <TenantShell tenant={tenant.useParams().tenant}>
          <Outlet />
        </TenantShell>
      );
    },
  });
  const client = createRoute({ getParentRoute: () => tenant, path: 'clients/c1', component: page });
  const router = createRouter({
    routeTree: root.addChildren([tenant.addChildren([client])]),
    history: createMemoryHistory({ initialEntries: ['/console/acme/clients/c1'] }),
    basepath: '/console',
    parseSearch,
    stringifySearch,
  });
  const view = render(
    <Providers transport={fake.transport} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
      <UnsavedGuardLayer />
    </Providers>,
  );
  return { ...fake, unmount: view.unmount };
}
