import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_HEADER_MARKER,
  idempotentOperations,
  renderIdempotent,
  TARGETS,
} from '#/generate';
import {
  generatePython,
  patchTemplate,
  PYTHON_HEADER_MARKER,
  PYTHON_TEMPLATES,
  renderPythonIdempotent,
  renderPythonOperations,
} from '#/python';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const documentsPresent = TARGETS.every((t) => existsSync(path.join(REPO_ROOT, t.document)));

const DOCUMENT = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Idempotent', version: '1' },
  paths: {
    '/b/{id}': {
      post: {
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/a': {
      post: {
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      get: { responses: { '200': { description: 'OK' } } },
    },
  },
});

describe('the idempotent operations shared by both languages', () => {
  it('lists the same operations the TypeScript file does', () => {
    const ts = [...renderIdempotent(DOCUMENT, 'd.json').matchAll(/^ {2}'([^']+)',$/gmu)].map(
      (m) => m[1],
    );
    expect(idempotentOperations(DOCUMENT, 'd.json')).toEqual(ts);
    expect(ts).toEqual(['POST /a', 'POST /b/{id}']);
  });
});

describe('the Python idempotent file', () => {
  it('is a sorted frozenset of method and path template pairs under a header', () => {
    const text = renderPythonIdempotent(DOCUMENT, 'd.json');
    expect(text.startsWith(PYTHON_HEADER_MARKER)).toBe(true);
    expect(text).toContain('IDEMPOTENT_OPERATIONS: frozenset[tuple[str, str]] = frozenset(');
    const pairs = [...text.matchAll(/^ {8}\("([A-Z]+)", "([^"]+)"\),$/gmu)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(pairs).toEqual([
      ['POST', '/a'],
      ['POST', '/b/{id}'],
    ]);
    expect(renderPythonIdempotent(DOCUMENT, 'd.json')).toBe(text);
  });

  it('is an empty frozenset when no operation takes a key', () => {
    const none = JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'n', version: '1' },
      paths: {},
    });
    expect(renderPythonIdempotent(none, 'n.json')).toContain('= frozenset()');
  });
});

describe('the Python operations file', () => {
  it('imports each operation module of the generated package, sorted, and lists them', () => {
    const text = renderPythonOperations('admin', ['b_op', 'a_op'], 'd.json');
    expect(text.startsWith(PYTHON_HEADER_MARKER)).toBe(true);
    expect(text).toContain(
      'from odudu._generated.admin.api.default import (\n    a_op,\n    b_op,\n)',
    );
    expect(text).toContain('__all__ = [\n    "a_op",\n    "b_op",\n]');
    expect(renderPythonOperations('admin', ['b_op', 'a_op'], 'd.json')).toBe(text);
  });
});

describe('the template patches', () => {
  it('name the five templates that write httpx2, Self or StrEnum', () => {
    expect([...PYTHON_TEMPLATES].sort()).toEqual([
      'client.py.jinja',
      'endpoint_macros.py.jinja',
      'endpoint_module.py.jinja',
      'str_enum.py.jinja',
      'types.py.jinja',
    ]);
  });

  it('write a string enum as str and Enum, which Python 3.10 has', () => {
    const patched = patchTemplate(
      'str_enum.py.jinja',
      'from enum import StrEnum\n\nclass A(StrEnum):\n    pass\n',
    );
    expect(patched).toBe('from enum import Enum\n\nclass A(str, Enum):\n    pass\n');
  });

  it('turn httpx2 into httpx and import Self from typing_extensions', () => {
    const patched = patchTemplate(
      'client.py.jinja',
      'from typing import Any, Self\nimport httpx2\nx: httpx2.Client\n',
    );
    expect(patched).toBe(
      'from typing import Any\nfrom typing_extensions import Self\nimport httpx\nx: httpx.Client\n',
    );
    expect(patchTemplate('types.py.jinja', 'a httpx2.Client')).toBe('a httpx.Client');
  });

  it('refuse a template the generator changed under them', () => {
    expect(() => patchTemplate('client.py.jinja', 'import httpx2\n')).toThrow(/Self/u);
    expect(() => patchTemplate('types.py.jinja', 'nothing here')).toThrow(/httpx2/u);
    expect(() => patchTemplate('str_enum.py.jinja', 'class A(Enum): pass')).toThrow(/StrEnum/u);
  });
});

describe.skipIf(!documentsPresent)('the generated Python clients', () => {
  it('are the same bytes twice, carry the header on every file and name no httpx2', async () => {
    const a = await mkdtemp(path.join(tmpdir(), 'sdk-py-'));
    const b = await mkdtemp(path.join(tmpdir(), 'sdk-py-'));
    try {
      const first = await generatePython(REPO_ROOT, a);
      const second = await generatePython(REPO_ROOT, b);
      expect(second.files).toEqual(first.files);
      for (const file of first.files) {
        const one = await readFile(path.join(a, file), 'utf8');
        expect(await readFile(path.join(b, file), 'utf8'), file).toBe(one);
        if (file.endsWith('.py')) expect(one.startsWith(PYTHON_HEADER_MARKER), file).toBe(true);
        expect(one, file).not.toContain('httpx2');
      }
      expect(first.files.length).toBeGreaterThan(100);
    } finally {
      await rm(a, { recursive: true });
      await rm(b, { recursive: true });
    }
  }, 180_000);

  it('match what is committed, with nothing extra left in the directory', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'sdk-py-'));
    try {
      const { files } = await generatePython(REPO_ROOT, out);
      for (const file of files) {
        const fresh = await readFile(path.join(out, file), 'utf8');
        const committed = await readFile(path.join(REPO_ROOT, file), 'utf8');
        expect(committed === fresh, `${file} is stale: run pnpm sdks:generate`).toBe(true);
      }
      const committedFiles = (
        await readdir(path.join(REPO_ROOT, 'sdks/python/src/odudu/_generated'), {
          recursive: true,
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isFile() && !entry.parentPath.includes('__pycache__'))
        .map((entry) =>
          path
            .relative(REPO_ROOT, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join('/'),
        );
      expect(committedFiles.sort()).toEqual([...files].sort());
    } finally {
      await rm(out, { recursive: true });
    }
  }, 180_000);

  it('use the TypeScript marker only for TypeScript files', () => {
    expect(PYTHON_HEADER_MARKER).toBe('# Generated by tools/sdk-generate');
    expect(GENERATED_HEADER_MARKER).toBe('// Generated by tools/sdk-generate');
  });
});
