import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OduduError } from '#/errors';
import { DEFAULT_STATIC_TREE_LIMITS, readStaticTree, type StaticTreeLimits } from '#/static-tree';

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const LIMITS: StaticTreeLimits = {
  maxFileBytes: 1024,
  maxFiles: 10,
  maxTotalBytes: 4096,
  maxEntries: 1000,
};
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'static-tree-'));
  dirs.push(dir);
  return dir;
}

describe('readStaticTree', () => {
  it('keys files by their `/`-separated path and carries the content type', async () => {
    const dir = await tree();
    await mkdir(join(dir, 'a', 'b'), { recursive: true });
    await writeFile(join(dir, 'top.js'), 'one');
    await writeFile(join(dir, 'a', 'b', 'deep.css'), 'two');

    const files = await readStaticTree(dir, TYPES, LIMITS, () => undefined);

    expect([...files.keys()].sort()).toEqual(['a/b/deep.css', 'top.js']);
    expect(files.get('top.js')?.contentType).toBe(TYPES['.js']);
    expect(files.get('a/b/deep.css')?.content.toString()).toBe('two');
  });

  it('skips dotfiles and dot directories, and extensions with no type', async () => {
    const dir = await tree();
    await mkdir(join(dir, '.private'));
    await writeFile(join(dir, '.private', 'secret.js'), 'x');
    await writeFile(join(dir, '.hidden.js'), 'x');
    await writeFile(join(dir, 'notes.txt'), 'x');
    await writeFile(join(dir, 'ok.js'), 'x');

    const files = await readStaticTree(dir, TYPES, LIMITS, () => undefined);

    expect([...files.keys()]).toEqual(['ok.js']);
  });

  it('never follows a symlink out of the tree', async () => {
    const dir = await tree();
    await symlink('/etc/hosts', join(dir, 'hosts.js'));
    await writeFile(join(dir, 'ok.js'), 'x');

    const files = await readStaticTree(dir, TYPES, LIMITS, () => undefined);

    expect([...files.keys()]).toEqual(['ok.js']);
  });

  it('refuses a file over maxFileBytes with a warning and keeps the rest', async () => {
    const dir = await tree();
    await writeFile(join(dir, 'big.js'), Buffer.alloc(LIMITS.maxFileBytes + 1));
    await writeFile(join(dir, 'ok.js'), 'x');
    const warnings: string[] = [];

    const files = await readStaticTree(dir, TYPES, LIMITS, (m) => warnings.push(m));

    expect([...files.keys()]).toEqual(['ok.js']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('big.js');
    expect(warnings[0]).toContain(String(LIMITS.maxFileBytes));
  });

  it('throws static_tree_too_large past maxFiles', async () => {
    const dir = await tree();
    for (let i = 0; i < 3; i++) await writeFile(join(dir, `f${String(i)}.js`), 'x');

    const failure = await readStaticTree(dir, TYPES, { ...LIMITS, maxFiles: 2 }, () => undefined)
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(OduduError);
    expect((failure as OduduError).code).toBe('static_tree_too_large');
  });

  it('throws static_tree_too_large past maxTotalBytes', async () => {
    const dir = await tree();
    await writeFile(join(dir, 'a.js'), Buffer.alloc(600));
    await writeFile(join(dir, 'b.js'), Buffer.alloc(600));

    const failure = await readStaticTree(
      dir,
      TYPES,
      { ...LIMITS, maxTotalBytes: 1000 },
      () => undefined,
    )
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(OduduError);
    expect((failure as OduduError).code).toBe('static_tree_too_large');
  });

  it('reads with the console defaults when no limits are given', async () => {
    const dir = await tree();
    await writeFile(join(dir, 'a.js'), 'x');

    const files = await readStaticTree(dir, TYPES, {}, () => undefined);

    expect([...files.keys()]).toEqual(['a.js']);
    expect(DEFAULT_STATIC_TREE_LIMITS).toEqual({
      maxFileBytes: 10 * 1024 * 1024,
      maxFiles: 1_000,
      maxTotalBytes: 64 * 1024 * 1024,
      maxEntries: 100_000,
    });
  });

  it('lets a caller raise a limit past the defaults for one call', async () => {
    const dir = await tree();
    for (let batch = 0; batch < 1_001; batch += 100) {
      const names = Array.from({ length: Math.min(100, 1_001 - batch) }, (_, i) => batch + i);
      await Promise.all(names.map((n) => writeFile(join(dir, `f${String(n)}.js`), 'x')));
    }

    const refused = await readStaticTree(dir, TYPES, {}, () => undefined)
      .then(() => undefined)
      .catch((err: unknown) => err);
    expect((refused as OduduError).code).toBe('static_tree_too_large');

    const files = await readStaticTree(dir, TYPES, { maxFiles: 5_000 }, () => undefined);
    expect(files.size).toBe(1_001);
  });

  it('bounds the entries it visits, typed or not', async () => {
    const dir = await tree();
    await mkdir(join(dir, 'd'));
    for (let i = 0; i < 4; i++) await symlink('/etc/hosts', join(dir, `link${String(i)}`));
    for (let i = 0; i < 4; i++) await mkdir(join(dir, 'd', `sub${String(i)}`));

    const failure = await readStaticTree(dir, TYPES, { maxEntries: 5 }, () => undefined)
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(OduduError);
    expect((failure as OduduError).code).toBe('static_tree_too_large');
    expect((failure as OduduError).message).toContain('entries');
  });
});
