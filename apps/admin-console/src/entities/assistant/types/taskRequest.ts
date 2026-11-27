// A page asked the assistant for a task: which tenant's panel, the profile the
// conversation starts under, the message to put in the field, and a count that
// makes a second request for the same task a new one.
export interface TaskRequest {
  tenant: string;
  profile: string;
  draft: string;
  seq: number;
}

// What a panel that a task replaced leaves for the one that replaces it: the
// message the person had not sent, and whether an answer was cut short.
export interface TaskCarry {
  tenant: string;
  draft: string;
  stopped: boolean;
}
