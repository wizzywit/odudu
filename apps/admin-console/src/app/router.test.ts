import { createMemoryHistory } from '@tanstack/react-router';
import { expect, it } from 'vitest';
import { createConsoleRouter } from '#/app/router';
import { EVERY_AREA } from '#/entities/area';

it('has a route for every area the rail can list', () => {
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: ['/'] }));
  const paths = Object.keys(router.routesByPath);
  const unrouted = EVERY_AREA.filter(
    (area) => !paths.includes(area.path === '' ? '/$tenant' : `/$tenant/${area.path}`),
  );
  expect(unrouted.map((area) => area.label)).toEqual([]);
});

it('draws a failure with its own panels, and leaves none to the router default', () => {
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: ['/'] }));
  expect(router.options.defaultErrorComponent).toBeDefined();
  expect(router.options.disableGlobalCatchBoundary).toBe(true);
  expect(router.routesById.__root__.options.errorComponent).toBeDefined();
  expect(router.routesById['/$tenant'].options.errorComponent).toBeDefined();
});
