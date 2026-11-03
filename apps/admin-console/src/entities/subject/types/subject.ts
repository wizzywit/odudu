import type { HeldAdminCapability } from '@odudu/contracts/admin';

export type SubjectType = 'user' | 'service' | 'agent_instance';

export interface Subject {
  id: string;
  type: SubjectType;
  // Null for a service or agent subject, which has no profile of its own.
  username: string | null;
  email: string | null;
  enabled: boolean;
  createdAt: string;
}

// Carried only by a listing filtered by `capability`.
export interface ListedSubject extends Subject {
  adminCapabilities?: HeldAdminCapability[] | undefined;
}

export interface SubjectChanges {
  username?: string;
  email?: string | null;
  enabled?: boolean;
}

export interface IssuedPassword {
  password: string;
}
