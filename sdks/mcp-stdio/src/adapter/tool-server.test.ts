import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadCatalogue, toolsOf } from '#/adapter/catalogue-file';
import { toolServer } from '#/adapter/tool-server';
import type { ToolResult } from '#/services/tool';
import { serveMcpStdio } from '#/adapter/stdio';

const tools = toolsOf(loadCatalogue());

function connect(run: (name: string, args: unknown) => Promise<ToolResult>) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const lines: string[] = [];
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => lines.push(...chunk.split('\n').filter(Boolean)));
  serveMcpStdio({
    stdin,
    stdout,
    server: () => toolServer('acme', tools, (tool, args) => run(tool.name, args), 'A note.'),
    onerror: () => undefined,
  });
  const send = (message: unknown) => stdin.write(`${JSON.stringify(message)}\n`);
  const reply = async (id: number): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 400; i += 1) {
      const found = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((message) => message.id === id);
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no answer to ${String(id)}`);
  };
  return { send, reply };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};

describe('the server the stdio transport serves', () => {
  it('says which tenant it serves, and carries the note', async () => {
    const { send, reply } = connect(() => Promise.reject(new Error('not called')));
    send(INITIALIZE);
    const result = (await reply(1)).result as {
      serverInfo: { name: string };
      instructions: string;
    };
    expect(result.serverInfo.name).toBe('odudu:acme');
    expect(result.instructions).toContain('tenant "acme"');
    expect(result.instructions.endsWith('A note.')).toBe(true);
  });

  it('lists every tool with the schema of the catalogue, under the tenant label', async () => {
    const { send, reply } = connect(() => Promise.reject(new Error('not called')));
    send(INITIALIZE);
    await reply(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = ((await reply(2)).result as { tools: Record<string, unknown>[] }).tools;
    expect(listed.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    const first = listed[0] as { description: string; inputSchema: unknown };
    expect(first.description.startsWith('[acme] ')).toBe(true);
    expect(first.inputSchema).toEqual(tools[0]?.inputSchema);
  });

  it('answers a call with what the runner returns', async () => {
    const seen: [string, unknown][] = [];
    const { send, reply } = connect((name, args) => {
      seen.push([name, args]);
      return Promise.resolve({
        isError: false,
        content: [{ type: 'text', text: '{"data":1}' }],
        structuredContent: { data: 1 },
      });
    });
    send(INITIALIZE);
    await reply(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    const result = (await reply(3)).result as { isError: boolean; structuredContent: unknown };
    expect(result).toMatchObject({ isError: false, structuredContent: { data: 1 } });
    expect(seen).toEqual([['whoami', {}]]);
  });
});
