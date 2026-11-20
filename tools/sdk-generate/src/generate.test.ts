import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_HEADER_MARKER, generateAll, renderSchema, TARGETS } from '#/generate';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const SMALL_DOCUMENT = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Small', version: '1' },
  paths: {
    '/things/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

// The documents are produced by the docs generator and are not committed, so
// a checkout that has not run it cannot compare against them. The sdks CI job
// runs the docs generator first and then fails on any diff, which is the same
// comparison without this skip.
const documentsPresent = TARGETS.every((t) => existsSync(path.join(REPO_ROOT, t.document)));

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'sdk-generate-'));
}

describe('the generator', () => {
  it('renders the same bytes for the same document, twice', async () => {
    const first = await renderSchema(SMALL_DOCUMENT, 'small.json');
    const second = await renderSchema(SMALL_DOCUMENT, 'small.json');
    expect(second).toBe(first);
    expect(first).toContain('"/things/{id}"');
  });

  it('refuses a document that is not OpenAPI 3.1', async () => {
    const v30 = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Old', version: '1' },
      paths: {},
    });
    await expect(renderSchema(v30, 'old.json')).rejects.toThrow(/not an OpenAPI 3\.1 document/u);
    await expect(renderSchema('{"swagger":"2.0"}', 'older.json')).rejects.toThrow(
      /not an OpenAPI 3\.1 document/u,
    );
  });

  it('starts every rendering with the generated-file header and nothing time-dependent', async () => {
    const text = await renderSchema(SMALL_DOCUMENT, 'apps/small.json');
    expect(text.startsWith(GENERATED_HEADER_MARKER)).toBe(true);
    expect(text.split('\n').slice(0, 3).join('\n')).toContain('apps/small.json');
    expect(text.split('\n').slice(0, 3).join('\n')).toMatch(/openapi-typescript \d+\.\d+\.\d+/u);
    expect(text.slice(0, 400)).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  });

  it('refuses a document that is missing, naming how to produce it', async () => {
    const out = await scratch();
    try {
      await expect(generateAll(out, out)).rejects.toThrow(/docs generate/u);
    } finally {
      await rm(out, { recursive: true });
    }
  });
});

describe.skipIf(!documentsPresent)('the generated clients', () => {
  it('running the generator twice leaves no diff', async () => {
    const a = await scratch();
    const b = await scratch();
    try {
      await generateAll(REPO_ROOT, a);
      await generateAll(REPO_ROOT, b);
      for (const target of TARGETS) {
        const first = await readFile(path.join(a, target.output), 'utf8');
        const second = await readFile(path.join(b, target.output), 'utf8');
        expect(second).toBe(first);
      }
    } finally {
      await rm(a, { recursive: true });
      await rm(b, { recursive: true });
    }
  });

  it('matches what is committed, so a stale schema fails', async () => {
    const out = await scratch();
    try {
      await generateAll(REPO_ROOT, out);
      for (const target of TARGETS) {
        const fresh = await readFile(path.join(out, target.output), 'utf8');
        const committed = await readFile(path.join(REPO_ROOT, target.output), 'utf8');
        expect(committed === fresh, `${target.output} is stale: run pnpm sdks:generate`).toBe(true);
      }
    } finally {
      await rm(out, { recursive: true });
    }
  });
});

describe('the generated directories', () => {
  it('carry the generated header on every file', async () => {
    for (const target of TARGETS) {
      const text = await readFile(path.join(REPO_ROOT, target.output), 'utf8');
      expect(text.startsWith(GENERATED_HEADER_MARKER), target.output).toBe(true);
    }
  });

  it('hold no hand-written file', async () => {
    for (const target of TARGETS) {
      const directory = path.dirname(path.join(REPO_ROOT, target.output));
      expect(await readdir(directory), directory).toEqual([path.basename(target.output)]);
    }
  });
});
