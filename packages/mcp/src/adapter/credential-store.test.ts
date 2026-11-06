import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCredentialStore } from '#/adapter/credential-store';
import type { RunTool, ToolRun } from '#/adapter/run-tool';

const ISSUER = 'https://id.example.com/tenants/acme';
let directory: string;

beforeEach(async () => {
  directory = join(await mkdtemp(join(tmpdir(), 'odudu-store-')), 'mcp');
});

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly input: string | undefined;
}

// An OS tool that keeps what it is given, as `security` or `secret-tool` would.
function fakeKeychain(options: { missing?: boolean; failPut?: boolean } = {}) {
  const calls: Call[] = [];
  const items = new Map<string, string>();
  const run: RunTool = (file, args, input): Promise<ToolRun> => {
    calls.push({ file, args, input });
    if (options.missing === true) return Promise.resolve({ kind: 'missing' });
    const account = args[args.indexOf('-a') + 1] ?? args[args.indexOf('account') + 1] ?? '';
    if (file === 'security' && args[0] === 'find-generic-password') {
      const found = items.get(account);
      return Promise.resolve(
        found === undefined
          ? { kind: 'exit', code: 44, stdout: '' }
          : { kind: 'exit', code: 0, stdout: `${found}\n` },
      );
    }
    if (file === 'security' && args[0] === '-i') {
      const hex = /-w (\S+)\s*$/u.exec(input ?? '')?.[1];
      const acct = /-a "([^"]+)"/u.exec(input ?? '')?.[1];
      if (options.failPut !== true && hex !== undefined && acct !== undefined) items.set(acct, hex);
      return Promise.resolve({ kind: 'exit', code: 0, stdout: '' });
    }
    if (file === 'security' && args[0] === 'delete-generic-password') {
      const had = items.delete(account);
      return Promise.resolve({ kind: 'exit', code: had ? 0 : 44, stdout: '' });
    }
    if (file === 'secret-tool' && args[0] === 'store') {
      if (options.failPut !== true) items.set(account, (input ?? '').trim());
      return Promise.resolve({ kind: 'exit', code: options.failPut === true ? 1 : 0, stdout: '' });
    }
    if (file === 'secret-tool' && args[0] === 'lookup') {
      const found = items.get(account);
      return Promise.resolve({
        kind: 'exit',
        code: found === undefined ? 1 : 0,
        stdout: found ?? '',
      });
    }
    if (file === 'secret-tool' && args[0] === 'clear') {
      items.delete(account);
      return Promise.resolve({ kind: 'exit', code: 0, stdout: '' });
    }
    return Promise.resolve({ kind: 'missing' });
  };
  return { run, calls, items };
}

function store(platform: NodeJS.Platform, run: RunTool, warned: string[] = [], account = ISSUER) {
  return createCredentialStore({
    account,
    directory,
    platform,
    run,
    warn: (line) => warned.push(line),
  });
}

const files = async () => readdir(directory).catch(() => []);

describe('the file store, where there is no OS credential store', () => {
  const none: RunTool = () => Promise.resolve({ kind: 'missing' });

  it('keeps a secret in a file only the user can read, in a directory only the user can enter', async () => {
    const warned: string[] = [];
    const s = store('linux', none, warned);
    await s.put('refresh-1');
    const [name] = await files();
    expect(name).toBeDefined();
    expect((await stat(join(directory, name ?? ''))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await s.get()).toBe('refresh-1');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/file/u);
    expect(warned[0]).not.toContain('refresh-1');
  });

  it('overwrites in place without ever widening the mode, and leaves no temporary file', async () => {
    const s = store('linux', none);
    await s.put('one');
    await s.put('two');
    expect(await s.get()).toBe('two');
    const names = await files();
    expect(names).toHaveLength(1);
    expect((await stat(join(directory, names[0] ?? ''))).mode & 0o777).toBe(0o600);
  });

  it('refuses a file that group or others can read, with one line that names it', async () => {
    const s = store('linux', none);
    await s.put('refresh-1');
    const [name] = await files();
    const path = join(directory, name ?? '');
    await chmod(path, 0o644);
    const error = await s.get().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'mcp_store_insecure' });
    const message = (error as Error).message;
    expect(message).not.toContain('\n');
    expect(message).toContain(path);
    expect(message).toMatch(/group or others/u);
    expect(message).not.toContain('refresh-1');
  });

  it('refuses a directory that group or others can enter', async () => {
    const s = store('linux', none);
    await s.put('refresh-1');
    await chmod(directory, 0o755);
    await expect(s.get()).rejects.toMatchObject({ code: 'mcp_store_insecure' });
    await expect(s.put('refresh-2')).rejects.toMatchObject({ code: 'mcp_store_insecure' });
  });

  it('refuses a symbolic link in place of the file', async () => {
    const s = store('linux', none);
    await s.put('x');
    const [name] = await files();
    const path = join(directory, name ?? '');
    const elsewhere = join(directory, '..', 'elsewhere');
    await writeFile(elsewhere, '{}', { mode: 0o600 });
    await rm(path);
    await symlink(elsewhere, path);
    await expect(s.get()).rejects.toMatchObject({ code: 'mcp_store_insecure' });
  });

  it('refuses a file that is not what it wrote, in one line', async () => {
    const s = store('linux', none);
    await s.put('x');
    const [name] = await files();
    await writeFile(join(directory, name ?? ''), 'not json', { mode: 0o600 });
    await expect(s.get()).rejects.toMatchObject({ code: 'mcp_store_corrupt' });
  });

  it('keeps one secret per issuer, so two tenants never share', async () => {
    const a = store('linux', none, [], ISSUER);
    const b = store('linux', none, [], 'https://id.example.com/tenants/other');
    await a.put('for-acme');
    expect(await b.get()).toBeNull();
    await b.put('for-other');
    expect(await a.get()).toBe('for-acme');
    expect(await b.get()).toBe('for-other');
    expect(await files()).toHaveLength(2);
  });

  it('is empty before a put, and clear removes the file, twice over', async () => {
    const s = store('linux', none);
    expect(await s.get()).toBeNull();
    await s.put('x');
    await s.clear();
    await s.clear();
    expect(await s.get()).toBeNull();
    expect(await files()).toEqual([]);
  });

  it('clears a file that is too wide to read, since removing it reveals nothing', async () => {
    const s = store('linux', none);
    await s.put('x');
    const [name] = await files();
    await chmod(join(directory, name ?? ''), 0o666);
    await s.clear();
    expect(await files()).toEqual([]);
  });

  it('writes a secret that is not text-safe and reads it back', async () => {
    const s = store('linux', none);
    const odd = `a"b\n${randomBytes(8).toString('hex')}é`;
    await s.put(odd);
    expect(await s.get()).toBe(odd);
  });

  it('can be made where a parent directory does not exist yet', async () => {
    await mkdir(join(directory, '..'), { recursive: true });
    const s = store('linux', none);
    await s.put('x');
    expect(await s.get()).toBe('x');
  });
});

describe('the OS credential store', () => {
  it('on macOS passes the secret to `security -i` on its input, hex-encoded, never in its arguments', async () => {
    const k = fakeKeychain();
    const s = store('darwin', k.run);
    await s.put('refresh-SECRET');
    const put = k.calls.find((c) => c.args[0] === '-i');
    expect(put?.file).toBe('security');
    expect(put?.args).toEqual(['-i']);
    expect(put?.input).toContain('add-generic-password');
    expect(put?.input).toContain(`-a "${ISSUER}"`);
    expect(put?.input).not.toContain('refresh-SECRET');
    expect(JSON.stringify(k.calls.map((c) => c.args))).not.toContain('SECRET');
    expect(await s.get()).toBe('refresh-SECRET');
    expect(await files()).toEqual([]);
  });

  it('on Linux passes the secret to `secret-tool store` on its input', async () => {
    const k = fakeKeychain();
    const s = store('linux', k.run);
    await s.put('refresh-SECRET');
    const put = k.calls.find((c) => c.args[0] === 'store');
    expect(put?.file).toBe('secret-tool');
    expect(JSON.stringify(put?.args)).not.toContain('SECRET');
    expect(put?.input).not.toContain('SECRET');
    expect(await s.get()).toBe('refresh-SECRET');
  });

  it('falls back to the file, and says so once, when the OS tool is not there', async () => {
    const warned: string[] = [];
    const s = store('darwin', fakeKeychain({ missing: true }).run, warned);
    await s.put('x');
    await s.put('y');
    expect(await s.get()).toBe('y');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/credential store/u);
  });

  it('falls back to the file when what it stored cannot be read back', async () => {
    const warned: string[] = [];
    const s = store('darwin', fakeKeychain({ failPut: true }).run, warned);
    await s.put('x');
    expect(await s.get()).toBe('x');
    expect(await files()).toHaveLength(1);
    expect(warned).toHaveLength(1);
  });

  it('uses no OS tool on a platform it has none for', async () => {
    const k = fakeKeychain();
    await store('win32', k.run).put('x');
    expect(k.calls).toEqual([]);
  });

  it('removes a file it earlier had to write once the OS store works', async () => {
    const none: RunTool = () => Promise.resolve({ kind: 'missing' });
    await store('darwin', none).put('old');
    expect(await files()).toHaveLength(1);
    await store('darwin', fakeKeychain().run).put('new');
    expect(await files()).toEqual([]);
  });

  it('clears the OS store and the file both', async () => {
    const k = fakeKeychain();
    const s = store('darwin', k.run);
    await s.put('x');
    const none: RunTool = () => Promise.resolve({ kind: 'missing' });
    await store('darwin', none).put('y');
    await s.clear();
    expect(k.items.size).toBe(0);
    expect(await files()).toEqual([]);
    expect(await s.get()).toBeNull();
  });

  it('keys the OS entry by issuer, so two tenants never share', async () => {
    const k = fakeKeychain();
    await store('darwin', k.run, [], ISSUER).put('a');
    expect(
      await store('darwin', k.run, [], 'https://id.example.com/tenants/other').get(),
    ).toBeNull();
  });
});
