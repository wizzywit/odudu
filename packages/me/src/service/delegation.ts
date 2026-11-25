// A client as a delegation names it: the row id the delegation stores and the
// OAuth `client_id` a person knows it by.
export interface MeDelegationClient {
  readonly id: string;
  readonly clientKey: string;
  readonly enabled: boolean;
  readonly agentType: boolean;
}

// A delegation with both clients named by their OAuth `client_id`.
export interface MeDelegationRecord {
  readonly id: string;
  readonly clientKey: string;
  readonly actorClientKey: string;
  readonly scopeCeiling: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}
