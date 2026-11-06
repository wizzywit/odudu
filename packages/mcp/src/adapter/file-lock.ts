import { mkdir, open, rm, stat } from 'node:fs/promises';
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

async function tryTake(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

// A lock file created with `wx`, so taking it is atomic across processes. One
// that is older than `staleMs` is removed, which a crashed holder leaves.
export function createFileLock(options: FileLockOptions): RefreshLock {
  return {
    async run(work) {
      await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
      const deadline = Date.now() + options.waitMs;
      while (!(await tryTake(options.path))) {
        const info = await stat(options.path).catch(() => null);
        if (info !== null && Date.now() - info.mtimeMs > options.staleMs) {
          await rm(options.path, { force: true });
        } else if (Date.now() >= deadline) {
          throw new StdioError(
            'mcp_lock_timeout',
            'another odudu mcp is refreshing this sign-in and did not finish; try again',
          );
        } else {
          await pause(options.pollMs);
        }
      }
      try {
        return await work();
      } finally {
        await rm(options.path, { force: true });
      }
    },
  };
}
