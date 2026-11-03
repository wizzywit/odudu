export interface Lockout {
  locked: boolean;
  lockedUntil: string | null;
  failureCount: number;
  lastFailureAt: string | null;
}
