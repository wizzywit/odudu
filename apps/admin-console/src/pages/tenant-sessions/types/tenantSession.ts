// A session listed across the whole tenant, so it names whose it is.
export interface TenantSession {
  id: string;
  subjectId: string;
  username: string | null;
  createdAt: string;
  lastActiveAt: string;
  remembered: boolean;
  clientIds: string[];
  device: string | null;
}

export interface SessionsEnded {
  ended: number;
  // Still live beyond the ones this call ended.
  remaining: number;
  // Left alone: the subject holds an admin capability the caller does not.
  beyondCeiling: number;
}
