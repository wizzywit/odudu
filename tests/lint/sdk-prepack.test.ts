import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SDKS = join(import.meta.dirname, '..', '..', 'sdks');

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
  files?: string[];
  repository?: { type?: string; url?: string; directory?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Package extends Manifest {
  directory: string;
}

function npmPackages(): Package[] {
  return readdirSync(SDKS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [
          {
            ...(JSON.parse(
              readFileSync(join(SDKS, entry.name, 'package.json'), 'utf8'),
            ) as Manifest),
            directory: entry.name,
          },
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

// A package that names another SDK as `workspace:*` is packed with that exact
// version, so a patch release of the dependency would leave a second copy of it
// installed beside the new one and `instanceof OduduError` would fail across
// the two. `workspace:^` packs as a caret range.
describe('how an SDK names another SDK', () => {
  const sdkNames = new Set(npmPackages().map((manifest) => manifest.name));

  it.each(npmPackages().map((manifest) => [manifest.name, manifest] as const))(
    '%s depends on SDKs with workspace:^',
    (_name, manifest) => {
      const all = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      };
      for (const [name, range] of Object.entries(all)) {
        if (sdkNames.has(name)) expect(range, name).toBe('workspace:^');
      }
    },
  );
});

function originSlug(): string {
  const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: SDKS,
    encoding: 'utf8',
  }).trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url);
  if (match?.[1] === undefined) throw new Error(`origin is not a GitHub remote: ${url}`);
  return match[1];
}

// npm checks `repository.url` against the repository the trusted publisher is
// configured for, and refuses the publish with E422 when it does not match.
describe('what npm reads to publish with provenance', () => {
  it.each(npmPackages().map((manifest) => [manifest.name, manifest] as const))(
    '%s names the repository and its own directory',
    (_name, manifest) => {
      expect(manifest.repository).toEqual({
        type: 'git',
        url: `git+https://github.com/${originSlug()}.git`,
        directory: `sdks/${manifest.directory}`,
      });
    },
  );

  it('names the repository in the Python package too', () => {
    const pyproject = readFileSync(join(SDKS, 'python', 'pyproject.toml'), 'utf8');
    const slug = originSlug();
    expect(pyproject).toContain(`Repository = "https://github.com/${slug}"`);
    expect(pyproject).toContain(`Source = "https://github.com/${slug}/tree/main/sdks/python"`);
  });
});
