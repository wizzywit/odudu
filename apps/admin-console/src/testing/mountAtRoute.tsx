import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type RouteComponent,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { parseSearch, stringifySearch } from '#/shared/lib/services/search';
import { TransportContext } from '#/shared/api/transport/useTransport';
import type { Transport } from '#/shared/api/transport/transport';

interface Mounted {
  basepath?: string;
  providers?: { transport: Transport; queryClient: QueryClient };
}

// One component at one route, read through the console's own search parser.
// The router comes back with the element, for a test that renders it itself.
export function routedElement(
  url: string,
  path: string,
  component: RouteComponent,
  { basepath = '/', providers }: Mounted = {},
) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
    basepath,
    parseSearch,
    stringifySearch,
  });
  const routed = <RouterProvider router={router} />;
  const element =
    providers === undefined ? (
      routed
    ) : (
      <TransportContext value={providers.transport}>
        <QueryClientProvider client={providers.queryClient}>{routed}</QueryClientProvider>
      </TransportContext>
    );
  return { router, element };
}

export function mountAtRoute(
  url: string,
  path: string,
  component: RouteComponent,
  options: Mounted = {},
) {
  const { router, element } = routedElement(url, path, component, options);
  const view = render(element);
  return { router, unmount: view.unmount };
}
