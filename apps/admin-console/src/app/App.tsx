import type { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Providers } from '#/app/Providers.tsx';
import type { ConsoleRouter } from '#/app/router.tsx';
import { ToastLayer } from '#/app/ToastLayer.tsx';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer.tsx';
import type { Transport } from '#/shared/transport/transport.ts';

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
    <Providers
      {...(transport === undefined ? {} : { transport })}
      {...(queryClient === undefined ? {} : { queryClient })}
    >
      <RouterProvider router={router} />
      <ToastLayer />
      <UnsavedGuardLayer />
    </Providers>
  );
}
