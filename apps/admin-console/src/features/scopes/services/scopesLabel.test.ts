import { expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import { scopesTrail } from '#/entities/scope';

it('words the Scopes crumb as the area catalogue words the Scopes area', () => {
  expect(scopesTrail('acme', 'billing').map((crumb) => crumb.label)).toContain(
    areaAt('scopes').label,
  );
});
