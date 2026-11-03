import { expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import { clientsTrail } from '#/entities/client';

it('words the Clients crumb as the area catalogue words the Clients area', () => {
  expect(clientsTrail('acme', 'billing').map((crumb) => crumb.label)).toContain(
    areaAt('clients').label,
  );
});
