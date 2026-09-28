import {
  createBrowserHistory,
  createRootRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { NavigationGuard } from '#/app/NavigationGuard.tsx';

function Shell() {
  return (
    <>
      <NavigationGuard />
      <header>
        <h1>Odudu console</h1>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function NotFound() {
  return <h2>Page not found</h2>;
}

// Each feature's index.ts exports its routes, and they are added here.
const routeTree = createRootRoute({ component: Shell, notFoundComponent: NotFound }).addChildren(
  [],
);

export function createConsoleRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, basepath: '/console', history });
}

export type ConsoleRouter = ReturnType<typeof createConsoleRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: ConsoleRouter;
  }
}
