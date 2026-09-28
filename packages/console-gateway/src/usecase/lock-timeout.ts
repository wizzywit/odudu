import { isLockNotAvailable } from '@odudu/db';

export interface Unavailable {
  readonly kind: 'unavailable';
}

const UNAVAILABLE: Unavailable = { kind: 'unavailable' };

// A console session's row lock is waited on for at most `lock_timeout`
// (the repository sets it), and a wait past it answers 502 with the
// session kept, rather than holding a pooled connection indefinitely.
export async function orUnavailable<T>(work: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await work();
  } catch (error: unknown) {
    if (isLockNotAvailable(error)) return UNAVAILABLE;
    throw error;
  }
}
