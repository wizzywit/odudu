import { describe, expect, it } from 'vitest';
import {
  checkedFlowId,
  flowInUseDetail,
  UNKNOWN_FLOW_CODE,
  unknownFlowRefusal,
} from '#/service/client-flow';

const FLOW = '01a1d359-812a-79ac-a805-e7c84d6ce48c';

describe('checkedFlowId', () => {
  it('takes a flow id or null', () => {
    expect(checkedFlowId(FLOW)).toBe(FLOW);
    expect(checkedFlowId(null)).toBeNull();
  });

  it.each([undefined, '', 'staff', 7, true, {}])('refuses %j, naming the field', (value) => {
    expect(checkedFlowId(value)).toEqual({
      field: 'flow_id',
      description: 'flow_id must be the id of one of the tenant’s flows, or null',
    });
  });
});

describe('unknownFlowRefusal', () => {
  it('carries the stable code and says nothing of where the id came from', () => {
    expect(unknownFlowRefusal()).toEqual({
      field: 'flow_id',
      description: 'flow_id names no flow of this tenant',
      code: UNKNOWN_FLOW_CODE,
    });
    expect(UNKNOWN_FLOW_CODE).toBe('unknown_flow');
  });
});

describe('flowInUseDetail', () => {
  it('counts the clients and names those sampled', () => {
    expect(flowInUseDetail({ count: 1, sample: ['a'] })).toBe(
      'the flow is named by 1 client: a; set that client’s flow_id to another flow or null first',
    );
    expect(flowInUseDetail({ count: 12, sample: ['a', 'b'] })).toBe(
      'the flow is named by 12 clients: a, b and 10 more; set their flow_id to another flow or null first',
    );
  });

  it('says no more than that a client names it when the race left no sample', () => {
    expect(flowInUseDetail({ count: 0, sample: [] })).toBe(
      'a client names the flow; set its flow_id to another flow or null first',
    );
  });
});
