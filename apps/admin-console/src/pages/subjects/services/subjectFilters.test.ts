import { expect, it } from 'vitest';
import { CAPABILITY_FILTER } from '#/pages/subjects/services/subjectFilters';

it('offers everyone first, then the server filter values, any worded as such', () => {
  expect(CAPABILITY_FILTER[0]).toEqual({ id: 'all', label: 'Holding anything or nothing' });
  expect(CAPABILITY_FILTER).toContainEqual({ id: 'any', label: 'Any capability' });
});
