import { expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import { groupsTrail } from '#/entities/group';

it('words the Groups crumb as the area catalogue words the Groups area', () => {
  expect(groupsTrail('acme', 'engineering').map((crumb) => crumb.label)).toContain(
    areaAt('groups').label,
  );
});
