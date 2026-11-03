import { expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import { rolesTrail } from '#/entities/role';

it('words the Roles crumb as the area catalogue words the Roles area', () => {
  expect(rolesTrail('acme', 'auditor').map((crumb) => crumb.label)).toContain(
    areaAt('roles').label,
  );
});
