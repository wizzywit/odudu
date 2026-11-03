import { expect, it } from 'vitest';
import { scopeFrames } from '#/pages/scopes/services/scopeFrame';

it('frames the record and the creation page, each with the trail that ends at it', () => {
  const frames = scopeFrames('acme', (_tenant, current) => [{ label: current }]);
  expect(frames.record).toEqual({ title: 'Scope', breadcrumb: [{ label: 'Scope' }] });
  expect(frames.creation.title).toBe('Create a scope');
});
