export interface ClientSession {
  id: string;
  subject_id: string;
  username: string | null;
  created_at: string;
  last_active_at: string;
  remembered: boolean;
  client_ids: string[];
  device: string | null;
}

export interface ClientSessionList {
  items: ClientSession[];
  next?: string | undefined;
}

// `remaining` is what is still live for the next call; `beyond_ceiling` was
// left alone because its subject holds a capability the caller does not.
export interface RevokedGrants {
  revoked: number;
  beyond_ceiling: number;
  remaining: number;
}
