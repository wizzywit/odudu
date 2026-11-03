import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleReferences } from './architecture/imports.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTITIES = path.join(ROOT, 'apps/admin-console/src/entities');

// The entities a service may import values from, as the dependency rule
// `console-service-entity-index-type-only` names them.
async function exemptEntities(): Promise<string[]> {
  const config = await readFile(path.join(ROOT, '.dependency-cruiser.cjs'), 'utf8');
  const named = /entities\/\(\?!\(\?:([a-z|-]+)\)\/\)/u.exec(config);
  return (named?.[1] ?? '').split('|');
}

describe('an entity whose index a service may import for values', () => {
  it('is named by the rule, and the names are the two that publish services only', async () => {
    expect((await exemptEntities()).sort()).toEqual(['administrator', 'area']);
  });

  it('exports nothing from use-cases, ui or repository', async () => {
    for (const name of await exemptEntities()) {
      const file = path.join(ENTITIES, name, 'index.ts');
      const references = moduleReferences(file, await readFile(file, 'utf8'));
      expect(references.length, name).toBeGreaterThan(0);
      for (const { specifier } of references) {
        expect(specifier, `${name}: ${specifier}`).toMatch(
          new RegExp(`^#/entities/${name}/(?:services|types)/`, 'u'),
        );
      }
    }
  });
});
