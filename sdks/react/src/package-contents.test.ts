import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('what the package publishes', () => {
  it('ships dist only, built from an entry that never reaches the test helpers', () => {
    const manifest = JSON.parse(read('../package.json')) as { files: string[] };
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md', 'README.md']);
    expect(read('../tsup.config.ts')).toContain("index: 'src/index.ts'");
    expect(read('./index.ts')).not.toContain('testing');
  });

  it('marks the bundle for the browser, so a server component imports a reference', () => {
    expect(read('../tsup.config.ts')).toContain(`banner: { js: "'use client';" }`);
  });

  it('exposes the root, with react and react-dom as peers and the core as a dependency', () => {
    const manifest = JSON.parse(read('../package.json')) as {
      exports: Record<string, { types: string; default: string }>;
      peerDependencies: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    });
    expect(manifest.peerDependencies).toEqual({ react: '^19.0.0', 'react-dom': '^19.0.0' });
    expect(Object.keys(manifest.dependencies)).toEqual(['@odudu-io/oidc']);
  });

  it('imports nothing browser-only at load: every use of a browser global is inside a function', () => {
    for (const file of ['adapter/location.ts', 'adapter/pending-storage.ts', 'adapter/bff.ts']) {
      const top = read(`./${file}`)
        .split('\n')
        .filter((line) =>
          /^(const|let|var)\b.*\b(window|document|localStorage|sessionStorage)\b/u.test(line),
        );
      expect(top).toEqual([]);
    }
  });
});
