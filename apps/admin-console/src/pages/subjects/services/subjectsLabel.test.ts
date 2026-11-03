import { expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import { subjectsTrail } from '#/entities/subject';

it('words the Subjects crumb as the area catalogue words the Subjects area', () => {
  expect(subjectsTrail('acme', 'ada').map((crumb) => crumb.label)).toContain(
    areaAt('subjects').label,
  );
});
