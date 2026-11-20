import { McpServer } from '@modelcontextprotocol/server';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { serveMcpStdio } from '#/view/stdio';

function session() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => written.push(chunk));
  const errors: Error[] = [];
  const server = serveMcpStdio({
    stdin,
    stdout,
    server: () => {
      const made = new McpServer(
        { name: 'odudu', version: '1.0.0' },
        { capabilities: { tools: { listChanged: false } } },
      );
      made.registerTool('ping', { description: 'Answers.' }, () => ({
        content: [{ type: 'text' as const, text: 'pong' }],
      }));
      return made;
    },
    onerror: (error) => errors.push(error),
  });
  const send = (message: unknown) => stdin.write(`${JSON.stringify(message)}\n`);
  const lines = async (count: number) => {
    for (
      let i = 0;
      i < 200 && written.join('').split('\n').filter(Boolean).length < count;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return written.join('').split('\n').filter(Boolean);
  };
  return { stdin, stdout, server, send, lines, errors };
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

describe('the stdio transport', () => {
  it('answers a handshake and a tool listing on standard output, and every line is JSON-RPC', async () => {
    const s = session();
    s.send(INITIALIZE);
    s.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    s.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const lines = await s.lines(2);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const message = JSON.parse(line) as { jsonrpc?: string };
      expect(message.jsonrpc).toBe('2.0');
    }
    expect(lines.join('\n')).toContain('"ping"');
    s.stdin.end();
    await s.server.closed;
  });

  it('is closed by end of input, with nothing more written', async () => {
    const s = session();
    s.send(INITIALIZE);
    await s.lines(1);
    s.stdin.end();
    await s.server.closed;
    await s.server.close();
    expect(s.errors).toEqual([]);
  });

  it('can be closed by the process', async () => {
    const s = session();
    await s.server.close();
    await s.server.closed;
  });
});
