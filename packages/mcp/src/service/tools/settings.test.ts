import { settingsSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { settingsTools } from '#/service/tools/settings';

function named(name: string) {
  const found = settingsTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('settings tools', () => {
  describeReadTool({
    tool: named('get_settings'),
    response: settingsSchema,
    pattern: '/admin/tenants/:tenant/settings',
  });
});
