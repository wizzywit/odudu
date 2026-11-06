import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type RunTool } from '#/adapter/run-tool';
import type { CredentialStore } from '#/service/ports';
import { fileModeProblem } from '#/service/file-mode';
import { StdioError } from '#/service/stdio-error';

export interface CredentialStoreDeps {
  // The issuer: base URL and tenant.
  readonly account: string;
  readonly directory: string;
  readonly platform: NodeJS.Platform;
  readonly run: RunTool;
  // The effective user id the files must belong to; the process's own when left out.
  readonly uid?: number;
  // One line for a person; never a secret.
  readonly warn: (line: string) => void;
}

const SERVICE = 'odudu-mcp';
const SAFE_ACCOUNT = /^[\x21\x23-\x5b\x5d-\x7e]+$/u;

class Unavailable extends Error {}

const encode = (secret: string): string => Buffer.from(secret, 'utf8').toString('hex');
const decode = (hex: string): string => Buffer.from(hex.trim(), 'hex').toString('utf8');

// The operating system's own store, through its command-line tool. The secret
// travels on the tool's standard input and hex-encoded: an argument vector is
// readable by other processes, and hex needs no quoting. What was put is read
// back, because `security -i` exits 0 whether or not a command succeeded.
function keychainStore(
  platform: NodeJS.Platform,
  account: string,
  run: RunTool,
): CredentialStore | null {
  if (!SAFE_ACCOUNT.test(account)) return null;
  if (platform === 'darwin') {
    const get = async (): Promise<string | null> => {
      const res = await run('security', [
        'find-generic-password',
        '-s',
        SERVICE,
        '-a',
        account,
        '-w',
      ]);
      if (res.kind === 'missing') throw new Unavailable();
      if (res.code === 44) return null;
      if (res.code !== 0) throw new Unavailable();
      return decode(res.stdout);
    };
    return {
      get,
      async put(secret) {
        const res = await run(
          'security',
          ['-i'],
          `add-generic-password -U -s ${SERVICE} -a "${account}" -w ${encode(secret)}\n`,
        );
        if (res.kind === 'missing' || (await get()) !== secret) throw new Unavailable();
      },
      async clear() {
        const res = await run('security', [
          'delete-generic-password',
          '-s',
          SERVICE,
          '-a',
          account,
        ]);
        if (res.kind === 'missing') throw new Unavailable();
      },
    };
  }
  if (platform === 'linux') {
    const attributes = ['service', SERVICE, 'account', account];
    const get = async (): Promise<string | null> => {
      const res = await run('secret-tool', ['lookup', ...attributes]);
      if (res.kind === 'missing') throw new Unavailable();
      return res.code === 0 && res.stdout !== '' ? decode(res.stdout) : null;
    };
    return {
      get,
      async put(secret) {
        const res = await run(
          'secret-tool',
          ['store', '--label=Odudu MCP', ...attributes],
          `${encode(secret)}\n`,
        );
        if (res.kind === 'missing' || res.code !== 0 || (await get()) !== secret) {
          throw new Unavailable();
        }
      },
      async clear() {
        const res = await run('secret-tool', ['clear', ...attributes]);
        if (res.kind === 'missing') throw new Unavailable();
      },
    };
  }
  return null;
}

function insecure(what: 'file' | 'directory', path: string, problem: string): StdioError {
  return new StdioError(
    'mcp_store_insecure',
    `the credential ${what} ${path} ${problem}; fix it with chmod or remove it with odudu mcp --logout`,
  );
}

function corrupt(path: string): StdioError {
  return new StdioError(
    'mcp_store_corrupt',
    `the credential file ${path} is not one this command wrote; remove it with odudu mcp --logout`,
  );
}

// A file in a directory only the user can enter, written with `wx` to a name of
// its own and renamed into place, so no reader sees it partly written or wider
// than 0600, and refused on read if any bit for group or others is set. Windows
// has no such bits; the profile directory's own ACL is what protects it there.
function fileStore(
  account: string,
  directory: string,
  platform: NodeJS.Platform,
  uid: number | undefined,
): CredentialStore {
  const name = `${createHash('sha256').update(account).digest('hex').slice(0, 32)}.json`;
  const path = join(directory, name);
  const checkModes = platform !== 'win32';

  const foreign = (owner: number): boolean => checkModes && uid !== undefined && owner !== uid;

  async function checkDirectory(): Promise<boolean> {
    const info = await lstat(directory).catch(() => null);
    if (info === null) return false;
    if (info.isSymbolicLink()) throw insecure('directory', directory, 'is a symbolic link');
    if (foreign(info.uid)) throw insecure('directory', directory, 'is owned by another user');
    const problem = checkModes ? fileModeProblem(info.mode, 'directory') : undefined;
    if (problem !== undefined) throw insecure('directory', directory, problem);
    return true;
  }

  return {
    async get() {
      if (!(await checkDirectory())) return null;
      const info = await lstat(path).catch(() => null);
      if (info === null) return null;
      if (info.isSymbolicLink() || !info.isFile()) {
        throw insecure('file', path, 'is not a regular file');
      }
      if (foreign(info.uid)) throw insecure('file', path, 'is owned by another user');
      const problem = checkModes ? fileModeProblem(info.mode, 'file') : undefined;
      if (problem !== undefined) throw insecure('file', path, problem);
      const handle = await open(path, 'r');
      try {
        const parsed: unknown = JSON.parse(await handle.readFile('utf8'));
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('account' in parsed) ||
          !('secret' in parsed) ||
          parsed.account !== account ||
          typeof parsed.secret !== 'string'
        ) {
          throw corrupt(path);
        }
        return decode(parsed.secret);
      } catch (error) {
        throw error instanceof StdioError ? error : corrupt(path);
      } finally {
        await handle.close();
      }
    },
    async put(secret) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await checkDirectory();
      const temporary = join(directory, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ account, secret: encode(secret) }), 'utf8');
        await handle.close();
        await rename(temporary, path);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
        throw error;
      }
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

// The OS store where there is one, else a file, with one line on standard error
// saying where a secret went when it could not go to the OS store. A file left
// behind by an earlier fallback is removed once the OS store holds the secret.
export function createCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const files = fileStore(
    deps.account,
    deps.directory,
    deps.platform,
    deps.uid ?? process.geteuid?.(),
  );
  const keychain = keychainStore(deps.platform, deps.account, deps.run);
  let warned = false;

  return {
    async get() {
      try {
        const held = (await keychain?.get()) ?? null;
        if (held !== null) return held;
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
      }
      return files.get();
    },
    async put(secret) {
      try {
        if (keychain === null) throw new Unavailable();
        await keychain.put(secret);
        await files.clear();
        return;
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
      }
      await files.put(secret);
      if (!warned) {
        warned = true;
        deps.warn(
          `odudu mcp: the operating system credential store is not available; the sign-in is kept in a file under ${deps.directory} that only you can read`,
        );
      }
    },
    async clear() {
      try {
        await keychain?.clear();
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
      }
      await files.clear();
      // A locked or refusing keychain exits with a status of its own, so what is left is read back.
      let left: string | null = null;
      try {
        left = (await keychain?.get()) ?? null;
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
      }
      if (left !== null) {
        throw new StdioError(
          'mcp_logout_failed',
          'the sign-in is still in the operating system credential store; remove its odudu-mcp entry there',
        );
      }
    },
  };
}
