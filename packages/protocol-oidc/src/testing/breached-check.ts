import { createBreachedPasswordCheck } from '@odudu/domain-identity';

/** The dataset alone: a remote lookup in a test is a failure to see, never a request. */
export const noBreachedLookup = createBreachedPasswordCheck({
  fetchRange: () => Promise.reject(new Error('no remote lookup expected')),
});
