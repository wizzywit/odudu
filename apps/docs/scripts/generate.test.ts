import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildMeOpenApiDocument } from '@odudu/me/docs';
import { buildAdminOpenApiDocument } from '@odudu/protocol-admin/docs';
import { GENERATED_DIRS, generatedFiles, writeGenerated } from './generate.ts';

const DOCS_ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const COMMIT = 'abc1234';
const files = await generatedFiles(COMMIT);
const pages = [...files].filter(([name]) => name.endsWith('.md'));
const scratch = mkdtempSync(path.join(tmpdir(), 'odudu-generate-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('writing the generated reference', () => {
  it('begins every page with its front matter, then a banner naming the source and the commit', () => {
    expect(pages.length).toBeGreaterThan(10);
    for (const [name, text] of pages) {
      expect(text, name).toMatch(
        /^---\ntitle: .+\ndescription: .+\n(?:sidebar_\w+: .+\n)*---\n\n<!-- Generated from .+ at abc1234; do not edit\. -->\n\n# /u,
      );
    }
  });

  it('writes nothing outside the two directories git ignores', () => {
    for (const name of files.keys()) {
      expect(
        GENERATED_DIRS.some((dir) => name.startsWith(`${dir}/`)),
        name,
      ).toBe(true);
    }
  });

  it('is deterministic, in content and in order', async () => {
    expect([...(await generatedFiles(COMMIT))]).toEqual([...files]);
    expect([...files.keys()]).toEqual([...files.keys()].sort());
  });

  it('empties what it generates before it writes, so a removed page does not linger', () => {
    const stale = path.join(scratch, GENERATED_DIRS[0], 'admin-api/removed.md');
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, 'old');
    const kept = path.join(scratch, 'content/en/reference/index.md');
    mkdirSync(path.dirname(kept), { recursive: true });
    writeFileSync(kept, 'hand written');

    writeGenerated(scratch, files);

    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(kept, 'utf8')).toBe('hand written');
    for (const [name, text] of files) {
      expect(readFileSync(path.join(scratch, name), 'utf8'), name).toBe(text);
    }
  });

  it('writes every machine-readable reference the site lists, and the admin OpenAPI document is the one the server builds', () => {
    expect(files.has('static/openapi/admin.json')).toBe(true);
    const written = JSON.parse(files.get('static/openapi/admin.json') ?? 'null') as unknown;
    expect(written).toEqual(JSON.parse(JSON.stringify(buildAdminOpenApiDocument())));
  });

  it('writes the me OpenAPI document the server builds, and a reference page set for it', () => {
    const written = JSON.parse(files.get('static/openapi/me.json') ?? 'null') as unknown;
    expect(written).toEqual(JSON.parse(JSON.stringify(buildMeOpenApiDocument())));
    expect(files.has('content/en/reference/generated/me-api/index.md')).toBe(true);
    expect(files.has('content/en/reference/generated/me-api/_category_.json')).toBe(true);
  });
});

describe('the generated reference on disk', () => {
  // The docs build and its tests read these files, so they must say what the
  // code says now. They are written by `pnpm generate`, which every build runs.
  it('is what the code generates now, apart from the commit it names', async () => {
    const first = path.join(DOCS_ROOT, [...files.keys()][0] ?? '');
    expect(existsSync(first), 'run pnpm --filter @odudu/docs generate').toBe(true);
    const named = /at ([0-9a-f]+|unknown); do not edit/u.exec(
      readFileSync(path.join(DOCS_ROOT, pages[0]?.[0] ?? ''), 'utf8'),
    )?.[1];
    const fresh = await generatedFiles(named ?? 'unknown');

    const onDisk = GENERATED_DIRS.flatMap((dir) =>
      walk(path.join(DOCS_ROOT, dir)).map((file) =>
        path.relative(DOCS_ROOT, file).split(path.sep).join('/'),
      ),
    ).sort();
    expect(onDisk).toEqual([...fresh.keys()]);
    for (const [name, text] of fresh) {
      expect(readFileSync(path.join(DOCS_ROOT, name), 'utf8') === text, name).toBe(true);
    }
  });

  it('is linked from the reference index, or from the index of its folder, so no page is an orphan', () => {
    const index = readFileSync(path.join(DOCS_ROOT, 'content/en/reference/index.md'), 'utf8');
    const prefix = 'content/en/reference/';
    const text = new Map(pages.map(([name, page]) => [name.slice(prefix.length), page]));
    const missing = [...text.keys()].filter((page) => {
      if (index.includes(`](./${page})`)) return false;
      const folder = path.posix.dirname(page);
      const file = path.posix.basename(page);
      return ![...text].some(
        ([other, content]) =>
          (other !== page &&
            path.posix.dirname(other) === folder &&
            content.includes(`](./${file})`)) ||
          content.includes(`](./${file}#`),
      );
    });
    expect(missing).toEqual([]);
  });
});
