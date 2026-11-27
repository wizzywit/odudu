// What a panel that a task replaced leaves for the one that replaces it: the
// message the person had not sent, and whether an answer was cut short.
export interface TaskCarry {
  tenant: string;
  draft: string;
  stopped: boolean;
}
