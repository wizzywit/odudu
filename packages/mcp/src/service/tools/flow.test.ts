import {
  flowSchema,
  listExecutionsResponseSchema,
  listFlowsResponseSchema,
} from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { flowTools } from '#/service/tools/flow';

function named(name: string) {
  const found = flowTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('flow tools', () => {
  describeReadTool({
    tool: named('get_flow_executions'),
    response: listExecutionsResponseSchema,
    pattern: '/admin/tenants/:tenant/flow/executions',
  });
  describeReadTool({
    tool: named('list_flows'),
    response: listFlowsResponseSchema,
    pattern: '/admin/tenants/:tenant/flows',
  });
  describeReadTool({
    tool: named('get_flow'),
    response: flowSchema,
    pattern: '/admin/tenants/:tenant/flows/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
});
