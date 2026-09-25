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

  it('rejects @odudu/domain-authz importing a protocol package', async () => {
    const found = await violations('no-domain-to-protocol');
    expect(found.some((v) => v.from.includes('domain-authz'))).toBe(true);
  });

  it('rejects @odudu/domain-audit importing a protocol package', async () => {
    const found = await violations('no-domain-to-protocol');
    expect(found.some((v) => v.from.includes('domain-audit'))).toBe(true);
  });

  it('rejects @odudu/account importing a protocol package', async () => {
    const found = await violations('no-domain-to-protocol');
    expect(found.some((v) => v.from.includes('/account/'))).toBe(true);
  });

  it('rejects @odudu/email importing a protocol package', async () => {
    const found = await violations('no-domain-to-protocol');
    expect(found.some((v) => v.from.includes('/email/'))).toBe(true);
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

  it('permits the admin API to import a protocol package', async () => {
    const found = await violations('no-protocol-to-protocol');
    expect(
      found.some((v) => v.from.includes('protocol-admin') && v.to.includes('protocol-oidc')),
    ).toBe(false);
  });

  it('forbids a protocol package importing the admin API', async () => {
    const found = await violations('no-protocol-to-admin');
    expect(
      found.some((v) => v.from.includes('protocol-oidc') && v.to.includes('protocol-admin')),
    ).toBe(true);
  });

  it('forbids the admin API importing a protocol package other than OIDC', async () => {
    const found = await violations('no-admin-to-other-protocol');
    expect(
      found.filter((v) => v.from.includes('protocol-admin') && v.to.includes('protocol-saml')),
    ).toHaveLength(1);
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

  it('rejects a service importing a repository', async () => {
    expect((await violations('service-is-a-leaf')).length).toBeGreaterThan(0);
  });

  it('does not flag a clean service with zero violations', async () => {
    const output = await cruiseFixtures();
    const fromGoodService = output.summary.violations.filter((v) =>
      v.from.endsWith('domain-example/src/service/some-service.ts'),
    );
    expect(fromGoodService).toHaveLength(0);
  });

  it('rejects @odudu/email service importing its own adapter', async () => {
    const found = await violations('service-is-a-leaf');
    expect(found.some((v) => v.from.includes('email/src/service/bad-service.ts'))).toBe(true);
  });

  it('does not flag a clean service in @odudu/email with zero violations', async () => {
    const output = await cruiseFixtures();
    const fromGoodService = output.summary.violations.filter((v) =>
      v.from.endsWith('email/src/service/some-service.ts'),
    );
    expect(fromGoodService).toHaveLength(0);
  });

  it('rejects a service importing src/testing/', async () => {
    const found = await violations('no-layer-to-testing');
    expect(
      found.some((v) => v.from.includes('domain-example/src/service/bad-service-testing.ts')),
    ).toBe(true);
  });

  it('does not flag a clean service for no-layer-to-testing', async () => {
    const found = await violations('no-layer-to-testing');
    expect(found.some((v) => v.from.endsWith('domain-example/src/service/some-service.ts'))).toBe(
      false,
    );
  });

  it('permits a view importing service, with zero violations', async () => {
    const output = await cruiseFixtures();
    const fromGoodView = output.summary.violations.filter((v) =>
      v.from.endsWith('domain-example/src/view/good-view.ts'),
    );
    expect(fromGoodView).toHaveLength(0);
  });
});
