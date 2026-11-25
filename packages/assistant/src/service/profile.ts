import type { Slot } from '#/service/slots';

/**
 * What a kind of turn is allowed to cost and where it runs: the slot its model
 * comes from and the most steps a turn may take before it must answer.
 */
export interface TaskProfile {
  readonly id: string;
  readonly slot: Slot;
  readonly maxSteps: number;
}
