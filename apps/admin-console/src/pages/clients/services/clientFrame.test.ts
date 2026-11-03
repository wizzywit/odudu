import { expect, it } from 'vitest';
import { clientFrames } from '#/pages/clients/services/clientFrame';

it('frames the record and the creation page, each with the trail that ends at it', () => {
  const frames = clientFrames('acme', (_tenant, current) => [{ label: current }]);
  expect(frames.record).toEqual({ title: 'Client', breadcrumb: [{ label: 'Client' }] });
  expect(frames.creation.title).toBe('Create a client');
});
