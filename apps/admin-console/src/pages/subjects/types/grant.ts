export interface Grant {
  id: string;
  clientId: string;
  clientKey: string;
  scope: string;
  createdAt: string;
  sessionId: string | null;
  offline: boolean;
  refreshExpiresAt: string | null;
}

export interface GrantsRevoked {
  revoked: number;
}
