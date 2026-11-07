import { generateClientKey } from '@odudu/crypto';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The command as a process: the real entry point, real standard streams and a
// real HTTP server standing in for the instance (a loopback address, so plain
// HTTP is allowed).

let server: Server;
let base: string;
let keyText: string;
let adminHeaders: Record<string, string | string[] | undefined> | undefined;

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

beforeAll(async () => {
  keyText = await generateClientKey();
  server = createServer((req, res) => {
    const issuer = `${base}/tenants/acme`;
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/.well-known/oauth-authorization-server/tenants/acme') {
        json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          code_challenge_methods_supported: ['S256'],
        });
      } else if (req.url === '/tenants/acme/protocol/openid-connect/token') {
        json({
          access_token: `${part({ alg: 'none' })}.${part({ iss: issuer, aud: [ADMIN_API_AUDIENCE], scope: 'mcp:read' })}.`,
          token_type: 'Bearer',
          expires_in: 300,
        });
      } else if (req.url === '/admin/tenants/acme/whoami') {
        adminHeaders = req.headers;
        json({
          subjectId: 's1',
          issuerTenantId: 't1',
          issuerTenantName: 'acme',
          capabilities: [],
          crossTenant: false,
        });
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

function command(
  args: string[],
  env: Record<string, string>,
  stdin: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/main.ts', 'mcp', ...args], {
      cwd: new URL('../..', import.meta.url).pathname,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    for (const line of stdin) child.stdin.write(`${line}\n`);
    const answered = () => stdout.split('\n').filter(Boolean).length;
    const wait = setInterval(() => {
      if (answered() >= stdin.filter((l) => l.includes('"id"')).length) {
        clearInterval(wait);
        child.stdin.end();
      }
    }, 20);
    setTimeout(() => {
      clearInterval(wait);
      child.stdin.end();
    }, 20_000).unref();
  });
}

describe('odudu mcp as a process', () => {
  it('writes only JSON-RPC to standard output, serves a tool call and exits 0 at end of input', async () => {
    const messages = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}',
    ];
    const r = await command(
      ['--base-url', base, '--tenant', 'acme', '--client-id', 'svc'],
      { ODUDU_MCP_KEY: keyText },
      messages,
    );
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect((JSON.parse(line) as { jsonrpc: string }).jsonrpc).toBe('2.0');
    expect(r.stdout).toContain('"subjectId":"s1"');
    expect(r.stderr).toBe('');
    expect(String(adminHeaders?.authorization)).toMatch(/^Bearer /u);
  }, 30_000);

  it('exits non-zero with one line on standard error and nothing on standard output when a key has no client', async () => {
    const r = await command(
      ['--base-url', base, '--tenant', 'acme'],
      { ODUDU_MCP_KEY: keyText },
      [],
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('--client-id');
    expect(r.stderr).not.toContain(keyText);
  }, 30_000);

  it('needs no database or server configuration', async () => {
    const r = await command(['--keygen'], {}, []);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ODUDU_MCP_KEY=/u);
  }, 30_000);
});
