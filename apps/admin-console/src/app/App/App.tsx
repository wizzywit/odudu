import type { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { recordFailure, RootBoundary, routeTemplate } from '#/widgets/failure';
import { Providers } from '#/app/Providers';
import type { ConsoleRouter } from '#/app/router';
import { ToastLayer } from '#/app/ToastLayer';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer';
import type { Transport } from '#/shared/api/transport/transport';

export function App({
  router,
  transport,
  queryClient,
}: {
  router: ConsoleRouter;
  transport?: Transport;
  queryClient?: QueryClient;
}) {
  return (
    <RootBoundary
      route={() => routeTemplate(router.state.matches)}
      record={(error, componentStack) =>
        recordFailure('rendering', error, routeTemplate(router.state.matches), componentStack)
      }
    >
      <Providers
        {...(transport === undefined ? {} : { transport })}
        {...(queryClient === undefined ? {} : { queryClient })}
      >
        <RouterProvider router={router} />
        <ToastLayer />
        <UnsavedGuardLayer />
      </Providers>
    </RootBoundary>
  );
}
