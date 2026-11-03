import { expect, it } from 'vitest';
import { placeOf } from '#/entities/area/services/place';

it('names an area, what it needs and where it lives under the tenant', () => {
  expect(placeOf('acme', 'keys')).toEqual({
    label: 'Signing keys',
    capability: 'manage-keys',
    href: '/console/acme/keys',
  });
});

it('puts the overview at the tenant itself', () => {
  expect(placeOf('acme', '')).toMatchObject({ label: 'Overview', href: '/console/acme' });
});

it('refuses a path no area has, as areaAt does', () => {
  expect(() => placeOf('acme', 'nowhere')).toThrow('no area is at "nowhere"');
});
