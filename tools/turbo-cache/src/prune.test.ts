import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneCache } from '#/prune';

let dir: string | undefined;

async function layout(entries: readonly string[], summaries: readonly (readonly string[])[]) {
  dir = await mkdtemp(join(tmpdir(), 'odudu-turbo-cache-'));
  const cache = join(dir, 'cache');
  const runs = join(dir, 'runs');
  await mkdir(cache);
  await mkdir(runs);
  for (const hash of entries) {
    for (const suffix of ['.tar.zst', '-meta.json', '-manifest.json']) {
      await writeFile(join(cache, `${hash}${suffix}`), '');
    }
  }
  for (const [index, hashes] of summaries.entries()) {
    const tasks = hashes.map((hash) => ({ taskId: `pkg#${hash}`, hash }));
    await writeFile(join(runs, `run-${String(index)}.json`), JSON.stringify({ tasks }));
  }
  return { cache, runs };
}

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('pruneCache', () => {
  it('keeps only the entries a run summary names, across every summary', async () => {
    const { cache, runs } = await layout(['aaaa', 'bbbb', 'cccc', 'dddd'], [['aaaa'], ['cccc']]);

    const result = await pruneCache(cache, runs);

    expect(result).toEqual({ kept: 2, removed: 2 });
    expect((await readdir(cache)).sort()).toEqual([
      'aaaa-manifest.json',
      'aaaa-meta.json',
      'aaaa.tar.zst',
      'cccc-manifest.json',
      'cccc-meta.json',
      'cccc.tar.zst',
    ]);
  });

  it('keeps a restored cache from growing across two runs', async () => {
    const first = await layout(['0001', '0002', '1111'], [['1111', '2221']]);
    await writeFile(join(first.cache, '2221.tar.zst'), '');
    await pruneCache(first.cache, first.runs);
    await rm(first.runs, { recursive: true });
    await mkdir(first.runs);
    await writeFile(join(first.cache, '2222.tar.zst'), '');
    await writeFile(
      join(first.runs, 'second.json'),
      JSON.stringify({ tasks: [{ hash: '2221' }, { hash: '2222' }] }),
    );

    await pruneCache(first.cache, first.runs);

    expect((await readdir(first.cache)).sort()).toEqual(['2221.tar.zst', '2222.tar.zst']);
  });

  it('refuses to prune when no run summary exists, rather than emptying the cache', async () => {
    const { cache, runs } = await layout(['aaaa'], []);

    await expect(pruneCache(cache, runs)).rejects.toThrow(runs);
    expect(await readdir(cache)).toHaveLength(3);
  });

  it('continues removing entries past a failure and throws one error naming all failed paths', async () => {
    const { cache, runs } = await layout(['aaaa', 'bbbb', 'cccc'], [['aaaa']]);
    const failPath = join(cache, 'bbbb.tar.zst');
    let removalAttempts = 0;
    const remover = async (path: string) => {
      removalAttempts += 1;
      if (path === failPath) {
        throw new Error(`permission denied: ${path}`);
      }
      await rm(path, { force: true });
    };

    let error: unknown;
    try {
      await pruneCache(cache, runs, remover);
    } catch (err) {
      error = err;
    }

    expect(removalAttempts).toBe(6);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toContain(failPath);
    expect((await readdir(cache)).sort()).toEqual([
      'aaaa-manifest.json',
      'aaaa-meta.json',
      'aaaa.tar.zst',
      'bbbb.tar.zst',
    ]);
  });
});
