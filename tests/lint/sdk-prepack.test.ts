import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SDKS = join(import.meta.dirname, '..', '..', 'sdks');

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
}

function npmPackages(): Manifest[] {
  return readdirSync(SDKS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [
          JSON.parse(readFileSync(join(SDKS, entry.name, 'package.json'), 'utf8')) as Manifest,
        ];
      } catch {
        return [];
      }
    });
}

// `dist/` is not committed, so `npm publish` or `npm pack` run by hand from a
// clean checkout would pack a package with no code in it.
describe('what packing an SDK does from a clean checkout', () => {
  it('finds the npm packages', () => {
    expect(npmPackages().length).toBeGreaterThanOrEqual(8);
  });

  it.each(npmPackages().map((manifest) => [manifest.name, manifest] as const))(
    '%s builds before it is packed',
    (_name, manifest) => {
      expect(manifest.scripts?.build).toBeDefined();
      expect(manifest.scripts?.prepack).toBe(manifest.scripts?.build);
    },
  );
});
