import {
  clientInstallationSchema,
  clientRecordSchema,
  countResponseSchema,
  listClientsResponseSchema,
} from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { clientTools } from '#/service/tools/clients';

function named(name: string) {
  const found = clientTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('clients tools', () => {
  describeReadTool({
    tool: named('list_clients'),
    response: listClientsResponseSchema,
    pattern: '/admin/tenants/:tenant/clients',
    paged: true,
    text: ['items', 0, 'name'],
  });
  describeReadTool({
    tool: named('count_clients'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/clients/count',
  });
  describeReadTool({
    tool: named('get_client'),
    response: clientRecordSchema,
    pattern: '/admin/tenants/:tenant/clients/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['name'],
    etag: true,
  });
  describeReadTool({
    tool: named('get_client_installation'),
    response: clientInstallationSchema,
    pattern: '/admin/tenants/:tenant/clients/:id/installation',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['default_scope'],
  });

  it('answers get_client_installation with exactly the keys that carry no secret', () => {
    const tool = named('get_client_installation');
    expect(tool.capability).toBe('manage-clients');
    expect(Object.keys(clientInstallationSchema.shape).sort()).toEqual([
      'client_id',
      'client_type',
      'default_scope',
      'discovery_url',
      'grant_types',
      'issuer',
      'post_logout_redirect_uris',
      'redirect_uris',
      'token_endpoint_auth_method',
    ]);
  });
});
