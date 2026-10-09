import { isLockNotAvailable } from '@odudu/db';

export interface Unavailable {
  readonly kind: 'unavailable';
}

const UNAVAILABLE: Unavailable = { kind: 'unavailable' };

// A console session's row lock is waited on for at most `lock_timeout`
// (the repository sets it) rather than holding a pooled connection. A wait
// past it is `unavailable`: the request answers 502 and the session is kept.
// A sign-in ending the session it replaces does not use this; there the
// failure costs only the old row's revoke (complete-login.ts).
export async function orUnavailable<T>(work: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await work();
  } catch (error: unknown) {
    if (isLockNotAvailable(error)) return UNAVAILABLE;
    throw error;
  }
}
