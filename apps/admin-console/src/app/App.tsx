import { RouterProvider } from '@tanstack/react-router';
import { Providers } from '#/app/Providers.tsx';
import type { ConsoleRouter } from '#/app/router.tsx';

export function App({ router }: { readonly router: ConsoleRouter }) {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
