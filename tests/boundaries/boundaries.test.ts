import { cruise } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.cjs';

const FIXTURES = 'tests/boundaries/fixtures';

async function violations(rule: string): Promise<number> {
  const result = await cruise([FIXTURES], { ...config.options, ruleSet: config, validate: true });
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output.summary.violations.filter((v) => v.rule.name === rule).length;
}

describe('boundary rules', () => {
  it('rejects a domain package importing a protocol package', async () => {
    expect(await violations('no-domain-to-protocol')).toBeGreaterThan(0);
  });

  it('rejects a view importing an adapter', async () => {
    expect(await violations('no-view-to-adapter')).toBeGreaterThan(0);
  });
});
