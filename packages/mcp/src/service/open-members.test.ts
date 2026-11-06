import { clientRecordSchema, listAuditResponseSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { TOOLS } from '#/service/catalogue';
import { exampleOf } from '#/testing/example-of';
import { respondingWith } from '#/testing/fake-caller';

const ID = '0192a0a0-0000-7000-8000-000000000001';
const INJECTED = {
  client_secret: 'injected-client-secret',
  password: 'injected-password',
  d: 'injected-private-exponent',
};

function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('members an open record carries', () => {
  it('drops an injected secret from get_settings', async () => {
    const caller = respondingWith({ access_token_ttl: 300, ...INJECTED });
    const result = await callTool(tool('get_settings'), caller, {});
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/injected-client-secret|injected-password/u);
    expect(result.structuredContent).toEqual({ data: { access_token_ttl: 300, d: INJECTED.d } });
  });

  it('drops an injected secret from audit detail', async () => {
    const body = exampleOf(listAuditResponseSchema) as { items: { detail: object }[] };
    Object.assign(body.items[0]?.detail ?? {}, INJECTED, { note: 'kept' });
    const result = await callTool(tool('list_audit'), respondingWith(body), {});
    expect(JSON.stringify(result)).not.toMatch(/injected-client-secret|injected-password/u);
    expect(JSON.stringify(result)).toContain('kept');
  });

  it('drops a private key member from a client key set and a secret beside it', async () => {
    const body = exampleOf(clientRecordSchema) as Record<string, unknown>;
    body.jwks = {
      keys: [{ kty: 'RSA', n: 'n', e: 'AQAB', d: 'injected-private-exponent', p: 'injected-p' }],
    };
    body.client_secret = 'injected-client-secret';
    const result = await callTool(tool('get_client'), respondingWith(body), { id: ID });
    expect(JSON.stringify(result)).not.toMatch(/injected-/u);
  });
});
