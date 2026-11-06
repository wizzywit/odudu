import { listKeysResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { keyTools } from '#/service/tools/keys';

function named(name: string) {
  const found = keyTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('keys tools', () => {
  describeReadTool({
    tool: named('list_keys'),
    response: listKeysResponseSchema,
    pattern: '/admin/tenants/:tenant/keys',
    paged: true,
    text: ['items', 0, 'kid'],
  });
});
