import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RefreshLock } from '#/service/ports';
import { StdioError } from '#/service/stdio-error';

export interface FileLockOptions {
  readonly path: string;
  // A lock older than this is a holder that died, and is taken.
  readonly staleMs: number;
  // How long to wait for a live holder before giving up.
  readonly waitMs: number;
  readonly pollMs: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Creates the lock with `wx`, so taking it is atomic across processes, and writes
// an owner token into it so its holder can tell later whether it is still its own.
async function tryTake(path: string, owner: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(owner);
    await handle.close();
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

// A stale lock is moved aside under a name of its own before it is removed, so of
// two processes that both found it stale only one renames it, and neither removes a
// lock another has since taken: the age is read again just before the move.
async function stealIfStale(path: string, staleMs: number): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (info === null || Date.now() - info.mtimeMs <= staleMs) return;
  const aside = `${path}.stale.${randomUUID()}`;
  const again = await stat(path).catch(() => null);
  if (again === null || Date.now() - again.mtimeMs <= staleMs) return;
  await rename(path, aside).catch(() => undefined);
  await rm(aside, { force: true });
}

// A lock file with an owner token. One older than `staleMs` is a holder that died,
// and is taken; a holder removes the file only if it still holds its own token.
export function createFileLock(options: FileLockOptions): RefreshLock {
  return {
    async run(work) {
      await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
      const owner = randomUUID();
      const deadline = Date.now() + options.waitMs;
      while (!(await tryTake(options.path, owner))) {
        await stealIfStale(options.path, options.staleMs);
        if (Date.now() >= deadline) {
          throw new StdioError(
            'mcp_lock_timeout',
            'another odudu mcp is refreshing this sign-in and did not finish; try again',
          );
        }
        await pause(options.pollMs);
      }
      try {
        return await work();
      } finally {
        const held = await readFile(options.path, 'utf8').catch(() => null);
        if (held === owner) await rm(options.path, { force: true });
      }
    },
  };
}
