import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { runTool } from '#/adapter/run-tool';
import { configDirectory } from '#/service/config-dir';
import type { McpIo } from '#/service/mcp-io';

export function processMcpIo(): McpIo {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    platform: process.platform,
    configDir: configDirectory(process.env, homedir(), process.platform),
    run: runTool,
    fetch,
    now: () => new Date(),
    entropy: (bytes) => randomBytes(bytes),
  };
}
