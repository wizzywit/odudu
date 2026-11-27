// A page asked the assistant for a task: which tenant's panel, the profile the
// conversation starts under, and the message to put in the field.
export interface AskedTask {
  tenant: string;
  profile: string;
  draft: string;
}

// The same, as the panel is handed it: a count makes a second request for the
// same task a new one.
export interface TaskRequest extends AskedTask {
  seq: number;
}
