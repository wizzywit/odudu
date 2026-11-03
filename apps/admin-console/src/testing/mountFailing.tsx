import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type RouteComponent,
} from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { RouteFailure, ShellFailure } from '#/widgets/failure';
import { createQueryClient } from '#/shared/repository/queryClient';
import { TransportContext } from '#/shared/transport/useTransport';
import { fakeTransport } from '#/testing/fakeTransport';

function withProviders(routed: ReactElement): ReactElement {
  return (
    <TransportContext value={fakeTransport({}).transport}>
      <QueryClientProvider client={createQueryClient()}>{routed}</QueryClientProvider>
    </TransportContext>
  );
}

// The console's failure panels under a real router: `/$tenant/clients` draws
// `page`, which is expected to throw, with the router's default error
// component or, for `alone`, the one the shell-drawing routes use.
export function failingAt(path: string, page: () => ReactNode, alone = false): ReactElement {
  const root = createRootRoute();
  const tenant = createRoute({ getParentRoute: () => root, path: '$tenant' });
  const area = createRoute({
    getParentRoute: () => tenant,
    path: 'clients',
    component: page,
    ...(alone ? { errorComponent: ShellFailure } : {}),
  });
  const router = createRouter({
    routeTree: root.addChildren([tenant.addChildren([area])]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultErrorComponent: RouteFailure,
  });
  return withProviders(<RouterProvider router={router} />);
}

// One component at the root route, under the same providers.
export function routedWithProviders(component: RouteComponent): ReactElement {
  const root = createRootRoute({ component });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return withProviders(<RouterProvider router={router} />);
}
