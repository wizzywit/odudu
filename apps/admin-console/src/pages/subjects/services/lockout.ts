import { counted } from '#/shared/services/format';
import type { Read } from '#/shared/services/read';
import { type Lockout } from '#/pages/subjects/types/lockout';

export interface LockoutSummary {
  tone: 'neutral' | 'danger';
  state: 'locked' | 'not locked';
  text: string;
}

function failures(count: number): string {
  return counted(count, 'failed sign-in', 'failed sign-ins');
}

// `locked` is the server's judgement, so a clock skewed here cannot say
// otherwise; the times are shown beside this text, not in it.
export function lockoutSummary(lockout: Lockout): LockoutSummary {
  if (lockout.locked) {
    return {
      tone: 'danger',
      state: 'locked',
      text: `Locked after ${failures(lockout.failureCount)} in a row. Every sign-in is refused, the right password too, until the lock lifts or is cleared.`,
    };
  }
  if (lockout.failureCount === 0) {
    return { tone: 'neutral', state: 'not locked', text: 'No failed sign-ins on record.' };
  }
  return {
    tone: 'neutral',
    state: 'not locked',
    text: `${failures(lockout.failureCount)} on record. The next failure counts on from them, until a quiet spell or the right password ends the run.`,
  };
}

export interface LockoutView {
  lockout: Lockout;
  summary: LockoutSummary;
}

// The lockout and what to say of it, or null until it has been read.
export function lockoutViewOf(read: Read<Lockout>): LockoutView | null {
  return read.status === 'ready'
    ? { lockout: read.data, summary: lockoutSummary(read.data) }
    : null;
}
