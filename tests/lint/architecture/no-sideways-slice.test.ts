import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanApps, segments, type ModuleReference } from './imports.ts';
import { ARCHITECTURE_SCAN_TIMEOUT, checkRule } from './rule.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(import.meta.dirname, '../fixtures/architecture/no-sideways-slice');
const SLICE_LAYERS = new Set(['features', 'widgets', 'pages', 'entities']);
const ALIAS_PREFIXES = ['#/', '@site/src/'];

interface Slice {
  layer: string;
  name: string;
}

function ownSlice(file: string): Slice | undefined {
  const parts = segments(file);
  const srcAt = parts.indexOf('src');
  const [layer, name] = parts.slice(srcAt + 1);
  const depth = parts.length - srcAt - 1;
  if (layer === undefined || name === undefined || depth < 3 || !SLICE_LAYERS.has(layer)) {
    return undefined;
  }
  return { layer, name };
}

function importedSlice(specifier: string): Slice | undefined {
  const prefix = ALIAS_PREFIXES.find((candidate) => specifier.startsWith(candidate));
  if (prefix === undefined) return undefined;
  const [layer, name] = segments(specifier.slice(prefix.length));
  if (layer === undefined || name === undefined || !SLICE_LAYERS.has(layer)) return undefined;
  return { layer, name };
}

export function sidewaysImports(file: string, references: ModuleReference[]): ModuleReference[] {
  const own = ownSlice(file);
  if (own === undefined) return [];
  return references.filter((reference) => {
    if (segments(reference.specifier).includes('@x')) return false;
    const target = importedSlice(reference.specifier);
    return target?.layer === own.layer && target.name !== own.name;
  });
}

export async function findSidewaysBreaches(
  root: string,
): Promise<{ files: string[]; lines: number }> {
  const files: string[] = [];
  let lines = 0;
  for (const { file, references } of await scanApps(root)) {
    const sideways = sidewaysImports(file, references);
    if (sideways.length > 0) {
      files.push(file);
      lines += sideways.length;
    }
  }
  return { files, lines };
}

describe('no-sideways-slice', () => {
  it('flags a sideways import in the console and the docs, and nothing else', async () => {
    const { files, lines } = await findSidewaysBreaches(FIXTURE_ROOT);
    expect(files).toEqual([
      'apps/admin-console/src/features/alpha/ui/Sideways.tsx',
      'apps/admin-console/src/widgets/alpha/ui/Sideways.tsx',
      'apps/docs/src/features/alpha/usecase/index.ts',
    ]);
    expect(lines).toBe(6);
  });

  it(
    'has no sideways import outside the inventory',
    async () => {
      const { files } = await findSidewaysBreaches(REPO_ROOT);
      expect(checkRule('no-sideways-slice', files).errors).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );
});
