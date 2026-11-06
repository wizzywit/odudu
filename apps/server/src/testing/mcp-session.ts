import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { RunTool } from '@odudu/mcp';
import { mcpCommand, type McpIo } from '#/cli/mcp';

// A credential directory laid out as production's is, <config>/odudu/mcp, where
// the directory above it is the user's own: a bare mkdtemp directory would put
// /tmp, which the user does not own, above it.
export async function privateConfigDirectory(): Promise<string> {
  const directory = join(await mkdtemp(join(tmpdir(), 'odudu-config-')), 'odudu', 'mcp');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

const NOTHING: RunTool = () => Promise.resolve({ kind: 'missing' });

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string[];
  readonly lines: unknown[];
}

export async function runMcp(
  argv: string[],
  options: {
    env?: Record<string, string>;
    input?: unknown[];
    fetch?: typeof fetch;
    configDir?: string;
    openBrowser?: McpIo['openBrowser'];
    // End the input a moment after it is written, while its calls are still running.
    eof?: 'while-running';
  } = {},
): Promise<Run> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let out = '';
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    out += chunk;
  });
  const stderr: string[] = [];
  const configDir = options.configDir ?? (await privateConfigDirectory());
  const io: McpIo = {
    stdin,
    stdout,
    stderr: (line) => stderr.push(line),
    env: options.env ?? {},
    platform: 'linux',
    configDir,
    run: NOTHING,
    fetch: options.fetch ?? fetch,
    now: () => new Date(),
    entropy: (bytes) => Uint8Array.from({ length: bytes }, (_, i) => (i * 7 + 3) % 251),
    ...(options.openBrowser === undefined ? {} : { openBrowser: options.openBrowser }),
  };
  const done = mcpCommand(argv, io);
  for (const message of options.input ?? []) stdin.write(`${JSON.stringify(message)}\n`);
  if (options.input !== undefined && options.eof !== 'while-running') {
    // Wait for every answer a request among them asks for, then end the input.
    const wanted = options.input.filter(
      (m) => typeof m === 'object' && m !== null && 'id' in m,
    ).length;
    for (let i = 0; i < 400 && out.split('\n').filter(Boolean).length < wanted; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (options.eof === 'while-running') await new Promise((resolve) => setTimeout(resolve, 60));
  stdin.end();
  const code = await done;
  return {
    code,
    stdout: out,
    stderr,
    lines: out
      .split('\n')
      .filter(Boolean)
      .map((line): unknown => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      }),
  };
}

export const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
};
export const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
export const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
export const WHOAMI = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'whoami', arguments: {} },
};
export const SESSION = [INITIALIZE, INITIALIZED, LIST, WHOAMI];

export function byId(lines: unknown[], id: number): Record<string, unknown> {
  const found = lines.find((l) => typeof l === 'object' && l !== null && 'id' in l && l.id === id);
  if (typeof found !== 'object' || found === null) throw new Error(`no answer ${String(id)}`);
  return Object.fromEntries(Object.entries(found));
}

export function toolNames(lines: unknown[]): string[] {
  const result = byId(lines, 2).result as { tools: { name: string }[] };
  return result.tools.map((t) => t.name);
}
