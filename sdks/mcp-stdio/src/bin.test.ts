import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalogue, toolsOf } from '#/adapter/catalogue-file';
import { directCallerTools, visibleTools } from '#/services/visible-tools';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');
const OIDC = join(HERE, '../../oidc');

function tarballName(directory: string): string {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
}
const OIDC_TARBALL = tarballName(OIDC);
const PACKAGE_TARBALL = tarballName(PACKAGE);

// Installing from the registry takes seconds and a network, so the explicit
// CI step sets this and every other run of the package's tests leaves it out.
const ENABLED = process.env.ODUDU_RUN_BIN_TEST === '1';

// The registry serves the dependencies the tarball names; the unpublished
// workspace package it also needs is packed and installed beside it.
async function registryReachable(): Promise<boolean> {
  try {
    await run('npm', ['view', '@modelcontextprotocol/server@2.4.0', 'version'], {
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

let work: string | undefined;
let tarballs: string;
let app: string;
let reachable = false;

beforeAll(async () => {
  if (!ENABLED) {
    process.stderr.write(
      '\nSKIPPED bin.test.ts: ODUDU_RUN_BIN_TEST=1 is not set; the sdks job runs it in its own step.\n',
    );
    return;
  }
  for (const directory of [PACKAGE, OIDC]) {
    if (!existsSync(join(directory, 'dist/index.js'))) {
      throw new Error(`${directory} has no dist: build it before this test (pnpm build)`);
    }
  }
  work = await mkdtemp(join(tmpdir(), 'odudu-mcp-bin-'));
  tarballs = join(work, 'tarballs');
  app = join(work, 'app');
  await mkdir(tarballs);
  await mkdir(app);
  reachable = await registryReachable();
  if (!reachable && process.env.ODUDU_REQUIRE_REGISTRY === '1') {
    throw new Error('the npm registry is unreachable and this run requires it');
  }
  if (!reachable) {
    process.stderr.write(
      '\nSKIPPED bin.test.ts: the npm registry is unreachable, so the packed tarball cannot be ' +
        'installed with its dependencies. CI sets ODUDU_REQUIRE_REGISTRY=1, which fails instead.\n',
    );
    return;
  }
  for (const directory of [OIDC, PACKAGE]) {
    await run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: directory });
  }
  await run('npm', ['init', '-y'], { cwd: app });
  await run(
    'npm',
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(tarballs, OIDC_TARBALL),
      join(tarballs, PACKAGE_TARBALL),
    ],
    { cwd: app, timeout: 150_000 },
  );
}, 180_000);

afterAll(async () => {
  if (work !== undefined) await rm(work, { recursive: true, force: true });
});

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'bin-test', version: '1' },
  },
};

function converse(
  command: string,
  args: string[],
  env: Record<string, string>,
  messages: object[],
  answers: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: app, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.split('\n').filter(Boolean).length >= answers) child.stdin.end();
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    setTimeout(() => child.kill(), 40_000).unref();
  });
}

describe('the packed odudu-mcp command', () => {
  it('lists only what a consumer needs, and no source or internal module', async (ctx) => {
    if (!ENABLED || !reachable) ctx.skip();
    const { stdout } = await run('tar', ['-tzf', join(tarballs, PACKAGE_TARBALL)]);
    const entries = stdout.split('\n').filter(Boolean);
    expect(entries).toEqual(
      expect.arrayContaining([
        'package/dist/bin.js',
        'package/dist/index.js',
        'package/package.json',
        'package/LICENSE',
        'package/CHANGELOG.md',
        'package/README.md',
      ]),
    );
    expect(entries.filter((entry) => !entry.startsWith('package/dist/'))).toHaveLength(4);
    const { stdout: manifest } = await run('tar', [
      '-xzOf',
      join(tarballs, PACKAGE_TARBALL),
      'package/package.json',
    ]);
    expect(manifest).not.toContain('workspace:');
  });

  it('the packed tarball, run with a PATH that has no odudu, answers initialize and tools/list', async (ctx) => {
    if (!ENABLED || !reachable) ctx.skip();
    const tree = await run('find', ['node_modules', '-path', '*/@odudu/*'], { cwd: app });
    expect(tree.stdout).toBe('');
    const nodeDirectory = dirname(process.execPath);
    const r = await converse(
      join(app, 'node_modules/.bin/odudu-mcp'),
      ['--base-url', 'https://id.example.com', '--tenant', 'acme'],
      { PATH: nodeDirectory, HOME: work ?? nodeDirectory },
      [
        INITIALIZE,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ],
      2,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const [initialized, listed] = lines.map(
      (line) =>
        JSON.parse(line) as { jsonrpc: string; id: number; result: Record<string, unknown> },
    );
    expect(lines.map((line) => (JSON.parse(line) as { jsonrpc: string }).jsonrpc)).toEqual([
      '2.0',
      '2.0',
    ]);
    expect(initialized?.result).toMatchObject({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'odudu:acme', title: 'Odudu (acme)' },
    });
    const names = (listed?.result.tools as { name: string }[]).map((tool) => tool.name).sort();
    const expected = visibleTools(directCallerTools(toolsOf(loadCatalogue())), ['mcp:read'], false)
      .map((tool) => tool.name)
      .sort();
    expect(names.length).toBeGreaterThan(50);
    expect(names).toEqual(expected);
  }, 60_000);

  it('does not take an option value of --help for a request for help', async (ctx) => {
    if (!ENABLED || !reachable) ctx.skip();
    const r = await converse(
      join(app, 'node_modules/.bin/odudu-mcp'),
      ['--base-url', 'https://id.example.com', '--tenant', '--help'],
      { PATH: dirname(process.execPath), HOME: work ?? '' },
      [],
      1,
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
  });

  it('prints its options for --help and exits 0', async (ctx) => {
    if (!ENABLED || !reachable) ctx.skip();
    const { stdout } = await run(join(app, 'node_modules/.bin/odudu-mcp'), ['--help'], {
      cwd: app,
      env: { PATH: dirname(process.execPath) },
    });
    for (const option of ['--base-url', '--tenant', '--allow-writes', '--keygen', '--logout']) {
      expect(stdout).toContain(option);
    }
  });
});
