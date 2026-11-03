export interface SubjectSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  remembered: boolean;
  clientIds: string[];
}

export interface SessionsEnded {
  ended: number;
}
