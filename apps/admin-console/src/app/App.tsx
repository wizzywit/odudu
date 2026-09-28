import { RouterProvider } from '@tanstack/react-router';
import { Providers } from '#/app/Providers.tsx';
import type { ConsoleRouter } from '#/app/router.tsx';
import { ToastLayer } from '#/app/ToastLayer.tsx';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer.tsx';

export function App({ router }: { readonly router: ConsoleRouter }) {
  return (
    <Providers>
      <RouterProvider router={router} />
      <ToastLayer />
      <UnsavedGuardLayer />
    </Providers>
  );
}
