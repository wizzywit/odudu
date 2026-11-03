import { expect, it } from 'vitest';
import { routeTemplate } from '#/features/failure/services/routeTemplate';

it('names a route by the template of the last route matched, never an address', () => {
  const matches = [
    { routeId: '__root__' },
    { routeId: '/$tenant' },
    { routeId: '/$tenant/clients/$id' },
  ];
  expect(routeTemplate(matches)).toBe('/$tenant/clients/$id');
  expect(routeTemplate(matches.slice(0, 1))).toBe('/');
  expect(routeTemplate([])).toBe('(none)');
});
