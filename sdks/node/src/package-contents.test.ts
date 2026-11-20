import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('what the package publishes', () => {
  it('ships dist only, built from entries that never reach the test helpers', () => {
    const manifest = JSON.parse(read('../package.json')) as { files: string[] };
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md']);
    const config = read('../tsup.config.ts');
    for (const [name, source] of Object.entries({
      index: 'index',
      express: 'adapter/express',
      fastify: 'adapter/fastify',
      http: 'adapter/http',
    })) {
      expect(config).toContain(`${name}: 'src/${source}.ts'`);
    }
    for (const entry of ['index', 'adapter/express', 'adapter/fastify', 'adapter/http']) {
      expect(read(`./${entry}.ts`)).not.toContain('testing');
      expect(read(`./${entry}.ts`)).not.toContain('reference-verifier');
    }
  });

  it('exposes the root and the three adapters, with express and fastify optional peers', () => {
    const manifest = JSON.parse(read('../package.json')) as {
      exports: Record<string, { types: string; default: string }>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional: boolean }>;
    };
    expect(Object.keys(manifest.exports)).toEqual(['.', './express', './fastify', './http']);
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const file = subpath === '.' ? 'index' : subpath.slice(2);
      expect(target).toEqual({ types: `./dist/${file}.d.ts`, default: `./dist/${file}.js` });
    }
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(['express', 'fastify']);
    expect(manifest.peerDependenciesMeta).toEqual({
      express: { optional: true },
      fastify: { optional: true },
    });
  });

  it('keeps the reference verifier out of the published files', () => {
    const manifest = JSON.parse(read('../package.json')) as { files: string[] };
    expect(manifest.files).not.toContain('test');
  });
});
