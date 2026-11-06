import { whoamiResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { whoamiTools } from '#/service/tools/whoami';

function named(name: string) {
  const found = whoamiTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('whoami tools', () => {
  describeReadTool({
    tool: named('whoami'),
    response: whoamiResponseSchema,
    pattern: '/admin/tenants/:tenant/whoami',
  });
});
