import { listExecutionsResponseSchema } from '@odudu/contracts/admin';
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
});
