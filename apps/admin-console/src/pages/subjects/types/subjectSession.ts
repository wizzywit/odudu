export interface SubjectSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  remembered: boolean;
  clientIds: string[];
  device: string | null;
}

export interface SessionsEnded {
  ended: number;
}
