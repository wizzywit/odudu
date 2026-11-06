import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileLock } from '#/adapter/file-lock';

async function lockIn() {
  const directory = join(await mkdtemp(join(tmpdir(), 'odudu-lock-')), 'mcp');
  const path = join(directory, 'refresh.lock');
  return { directory, path };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the lock around a refresh', () => {
  it('lets one holder in at a time, in order', async () => {
    const { path } = await lockIn();
    const lock = createFileLock({ path, staleMs: 10_000, waitMs: 5_000, pollMs: 5 });
    const events: string[] = [];
    const work = (name: string) => async () => {
      events.push(`in:${name}`);
      await pause(30);
      events.push(`out:${name}`);
      return name;
    };
    const results = await Promise.all([
      lock.run(work('a')),
      lock.run(work('b')),
      lock.run(work('c')),
    ]);
    expect(results.sort()).toEqual(['a', 'b', 'c']);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]?.startsWith('in:')).toBe(true);
      expect(events[i + 1]).toBe(`out:${events[i]?.slice(3) ?? ''}`);
    }
  });

  it('leaves nothing behind, when the work succeeds and when it throws', async () => {
    const { directory, path } = await lockIn();
    const lock = createFileLock({ path, staleMs: 10_000, waitMs: 5_000, pollMs: 5 });
    await lock.run(() => Promise.resolve(1));
    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await readdir(directory)).toEqual([]);
  });

  it('takes a lock whose holder is long gone, and gives up on one that is held', async () => {
    const { directory, path } = await lockIn();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path, 'pid', { mode: 0o600 });
    const lock = createFileLock({ path, staleMs: 60_000, waitMs: 40, pollMs: 5 });
    await expect(lock.run(() => Promise.resolve(1))).rejects.toMatchObject({
      code: 'mcp_lock_timeout',
    });
    const old = new Date(Date.now() - 120_000);
    await utimes(path, old, old);
    await expect(lock.run(() => Promise.resolve(2))).resolves.toBe(2);
  });
});
