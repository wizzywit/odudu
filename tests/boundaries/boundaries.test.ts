import path from 'node:path';
import { cruise } from 'dependency-cruiser';
import type { ICruiseResult } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.cjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = 'tests/boundaries/fixtures';

async function cruiseFixtures(): Promise<ICruiseResult> {
  const result = await cruise([FIXTURES], {
    ...config.options,
    baseDir: REPO_ROOT,
    tsConfig: { fileName: path.join(REPO_ROOT, 'tsconfig.base.json') },
    ruleSet: config,
    validate: true,
  });
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output;
}

async function violations(rule: string): Promise<ICruiseResult['summary']['violations']> {
  const output = await cruiseFixtures();
  return output.summary.violations.filter((v) => v.rule.name === rule);
}

describe('boundary rules', { timeout: 60_000 }, () => {
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

  it('rejects the console gateway importing a protocol package', async () => {
    const found = await violations('console-gateway-imports-no-protocol');
    expect(
      found.some((v) => v.from.includes('console-gateway') && v.to.includes('protocol-oidc')),
    ).toBe(true);
  });

  it('rejects the console gateway importing a package outside its allowlist', async () => {
    const found = await violations('console-gateway-allowlist');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('console-gateway/src/foreign-domain.ts') && v.to.includes('/account/'),
      ),
    ).toBe(true);
  });

  it('permits the console gateway importing @odudu/domain-identity', async () => {
    const output = await cruiseFixtures();
    const fromAllowed = output.summary.violations.filter((v) =>
      v.from.endsWith('console-gateway/src/allowed.ts'),
    );
    expect(fromAllowed).toHaveLength(0);
  });

  it('rejects apps/server production code importing its test harness', async () => {
    const found = await violations('no-server-to-testing');
    expect(found.some((v) => v.from.endsWith('apps/server/src/leak.ts'))).toBe(true);
    expect(found.some((v) => v.from.endsWith('apps/server/src/testing/uses-harness.ts'))).toBe(
      false,
    );
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

  it('lets a test beside a layer reach src/testing/', async () => {
    const found = await violations('no-layer-to-testing');
    expect(found.some((v) => v.from.endsWith('domain-example/src/view/good-view.test.tsx'))).toBe(
      false,
    );
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

  it('permits a service importing a sibling service in the same package', async () => {
    const output = await cruiseFixtures();
    const composing = [
      'domain-example/src/service/composed-service.ts',
      'admin-console/src/features/clients/service.ts',
    ];
    for (const file of composing) {
      const importsService = output.modules.some(
        (m) =>
          m.source.endsWith(file) &&
          m.dependencies.some(
            (d) => !d.couldNotResolve && /\/service(?:\/|\.tsx?$)/u.test(d.resolved),
          ),
      );
      expect(importsService).toBe(true);
      expect(output.summary.violations.filter((v) => v.from.endsWith(file))).toHaveLength(0);
    }
  });

  it('rejects a single-file view importing a single-file adapter', async () => {
    const found = await violations('no-view-to-adapter');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('admin-console/src/features/clients/view.tsx') &&
          v.to.endsWith('admin-console/src/features/clients/adapter.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a console feature importing another feature's internals", async () => {
    const found = await violations('console-feature-imports-only-index');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/usecase/reachesIn.ts') &&
          v.to.endsWith('features/clients/service.ts'),
      ),
    ).toBe(true);
  });

  it("permits a console feature importing another feature's index.ts", async () => {
    const output = await cruiseFixtures();
    expect(
      output.summary.violations.filter((v) =>
        v.from.endsWith('features/subjects/usecase/usesIndex.ts'),
      ),
    ).toHaveLength(0);
  });

  it('rejects console shared code importing a feature', async () => {
    const found = await violations('console-shared-imports-no-feature');
    expect(found.some((v) => v.from.endsWith('shared/repository/featureLeak.ts'))).toBe(true);
  });

  it('rejects a console feature importing app/', async () => {
    const found = await violations('console-nothing-imports-app');
    expect(found.some((v) => v.from.endsWith('features/subjects/usecase/appLeak.ts'))).toBe(true);
  });

  it('rejects a console view importing shared/transport', async () => {
    const found = await violations('console-view-no-transport');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/view/SubjectList.tsx') &&
          v.to.endsWith('shared/transport/client.ts'),
      ),
    ).toBe(true);
  });
});
