import { isUuid } from '@odudu/kernel';

export const UNKNOWN_FLOW_CODE = 'unknown_flow';

export interface FlowFieldError {
  readonly field: 'flow_id';
  readonly description: string;
  readonly code?: string;
}

/** The shape of a client's `flow_id`: one flow's id, or null for the tenant's default. */
export function checkedFlowId(value: unknown): string | null | FlowFieldError {
  if (value === null) return null;
  if (typeof value === 'string' && isUuid(value)) return value;
  return {
    field: 'flow_id',
    description: 'flow_id must be the id of one of the tenant’s flows, or null',
  };
}

/** One answer for a flow that does not exist and for one that is another tenant's. */
export function unknownFlowRefusal(): FlowFieldError {
  return {
    field: 'flow_id',
    description: 'flow_id names no flow of this tenant',
    code: UNKNOWN_FLOW_CODE,
  };
}

export function flowInUseDetail(usage: { count: number; sample: readonly string[] }): string {
  if (usage.count === 0) {
    return 'a client names the flow; set its flow_id to another flow or null first';
  }
  const noun = usage.count === 1 ? 'client' : 'clients';
  const more = usage.count - usage.sample.length;
  const named = `${usage.sample.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}`;
  const pronoun = usage.count === 1 ? 'that client’s' : 'their';
  return `the flow is named by ${String(usage.count)} ${noun}: ${named}; set ${pronoun} flow_id to another flow or null first`;
}
