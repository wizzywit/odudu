import { cruise } from 'dependency-cruiser';
import type { ICruiseResult } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.cjs';

const FIXTURES = 'tests/boundaries/fixtures';

async function cruiseFixtures(): Promise<ICruiseResult> {
  const result = await cruise([FIXTURES], { ...config.options, ruleSet: config, validate: true });
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output;
}

async function violations(rule: string): Promise<ICruiseResult['summary']['violations']> {
  const output = await cruiseFixtures();
  return output.summary.violations.filter((v) => v.rule.name === rule);
}

describe('boundary rules', () => {
  it('rejects a domain package importing a protocol package', async () => {
    expect((await violations('no-domain-to-protocol')).length).toBeGreaterThan(0);
  });

  it('rejects a view importing an adapter', async () => {
    expect((await violations('no-view-to-adapter')).length).toBeGreaterThan(0);
  });

  it('rejects a protocol package importing another protocol package', async () => {
    const found = await violations('no-protocol-to-protocol');
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.some((v) => v.from.includes('protocol-example') && v.to.includes('protocol-other')),
    ).toBe(true);
  });

  it('does not flag a protocol package importing within itself', async () => {
    const found = await violations('no-protocol-to-protocol');
    expect(
      found.some((v) => v.from.includes('protocol-example') && v.to.includes('protocol-example')),
    ).toBe(false);
  });

  it('rejects a circular import', async () => {
    expect((await violations('no-circular')).length).toBeGreaterThan(0);
  });

  it('rejects a view importing a repository', async () => {
    expect((await violations('no-view-to-repository')).length).toBeGreaterThan(0);
  });

  it('rejects a usecase importing an adapter', async () => {
    expect((await violations('no-usecase-to-adapter')).length).toBeGreaterThan(0);
  });

  it('permits a view importing service, with zero violations', async () => {
    const output = await cruiseFixtures();
    const fromGoodView = output.summary.violations.filter((v) =>
      v.from.endsWith('domain-example/src/view/good-view.ts'),
    );
    expect(fromGoodView).toHaveLength(0);
  });
});
