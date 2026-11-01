import { expect, it } from 'vitest';
import { brandingOffer } from '#/features/clients/service/branding';

it('offers neither the editor nor a refusal until the caller is known', () => {
  expect(brandingOffer(undefined, [])).toBe('checking');
});

it('holds the tab for a missing manage-clients, whoever the client is', () => {
  expect(brandingOffer(['view-users'], ['manage-clients'])).toBe('held');
});

it('opens it for a caller holding manage-clients', () => {
  expect(brandingOffer(['manage-clients'], [])).toBe('open');
});
