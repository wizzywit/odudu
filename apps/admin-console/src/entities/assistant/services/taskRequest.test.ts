import { expect, it } from 'vitest';
import { requestFor } from '#/entities/assistant/services/taskRequest';

const REQUEST = { tenant: 'acme', profile: 'review-client', draft: 'Review.', seq: 1 };

it('is the request for the tenant asked about, and none for another', () => {
  expect(requestFor(REQUEST, 'acme')).toBe(REQUEST);
  expect(requestFor(REQUEST, 'demo')).toBeNull();
  expect(requestFor(null, 'acme')).toBeNull();
});
