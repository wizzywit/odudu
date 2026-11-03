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

  it('rejects a repository importing a usecase or a view', async () => {
    const found = await violations('no-repository-to-usecase-or-view');
    const from = found.map((v) => v.from);
    expect(from.some((f) => f.endsWith('repository/bad-repository-usecase.ts'))).toBe(true);
    expect(from.some((f) => f.endsWith('repository/bad-repository-view.ts'))).toBe(true);
    expect(from.some((f) => f.endsWith('repository/some-repository.ts'))).toBe(false);
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
      'admin-console/src/features/clients/services.ts',
    ];
    for (const file of composing) {
      const importsService = output.modules.some(
        (m) =>
          m.source.endsWith(file) &&
          m.dependencies.some(
            (d) => !d.couldNotResolve && /\/services?(?:\/|\.tsx?$)/u.test(d.resolved),
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
          v.from.endsWith('admin-console/src/features/clients/ui.tsx') &&
          v.to.endsWith('admin-console/src/features/clients/adapter.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a console feature importing another feature's internals", async () => {
    const found = await violations('console-feature-imports-only-index');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/use-cases/reachesIn.ts') &&
          v.to.endsWith('features/clients/services.ts'),
      ),
    ).toBe(true);
  });

  it("permits a console feature importing another feature's index.ts", async () => {
    const output = await cruiseFixtures();
    expect(
      output.modules.some((m) => m.source.endsWith('features/subjects/use-cases/usesIndex.ts')),
    ).toBe(true);
    expect(
      output.summary.violations.filter((v) =>
        v.from.endsWith('features/subjects/use-cases/usesIndex.ts'),
      ),
    ).toHaveLength(0);
  });

  it("rejects a docs feature importing another feature's internals", async () => {
    const found = await violations('docs-feature-imports-only-index');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/alpha/ui/crossFeature.ts') &&
          v.to.endsWith('features/beta/services/rules.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a docs route importing a feature's internals, and permits its index", async () => {
    const found = await violations('docs-feature-imports-only-index');
    expect(found.some((v) => v.from.endsWith('pages/index.tsx') && v.to.endsWith('ui/B.tsx'))).toBe(
      true,
    );
    expect(found.some((v) => v.from.endsWith('image-pages/index.tsx'))).toBe(false);
  });

  it("permits a docs feature using its own internals and another feature's index", async () => {
    const output = await cruiseFixtures();
    expect(
      output.summary.violations.filter((v) => v.from.endsWith('features/alpha/ui/usesIndex.ts')),
    ).toHaveLength(0);
  });

  it('rejects a docs service importing a view', async () => {
    const found = await violations('docs-service-imports-only-service');
    expect(found.some((v) => v.from.endsWith('features/alpha/services/reachesView.ts'))).toBe(true);
  });

  it('rejects a docs usecase importing a view', async () => {
    const found = await violations('docs-usecase-imports-no-view');
    expect(found.some((v) => v.from.endsWith('features/alpha/use-cases/useBack.ts'))).toBe(true);
  });

  it('rejects docs shared code importing a feature', async () => {
    const found = await violations('docs-shared-imports-no-feature');
    expect(found.some((v) => v.from.endsWith('shared/ui/Leaky.tsx'))).toBe(true);
  });

  it('rejects a docs view importing shared/platform, and permits a usecase', async () => {
    const found = await violations('docs-view-imports-no-platform');
    expect(found.some((v) => v.from.endsWith('features/alpha/ui/UsesPlatform.ts'))).toBe(true);
    expect(found.some((v) => v.from.endsWith('features/alpha/ui/UsesFeaturePlatform.ts'))).toBe(
      true,
    );
    expect(found.some((v) => v.from.endsWith('features/alpha/use-cases/useWatch.ts'))).toBe(false);
  });

  it('rejects a docs feature importing a route', async () => {
    const found = await violations('docs-nothing-imports-routes');
    expect(found.some((v) => v.from.endsWith('features/beta/ui/routeLeak.ts'))).toBe(true);
  });

  it('rejects a docs feature index publishing something outside ui, use-cases and services', async () => {
    const found = await violations('docs-index-exports-view-usecase-service');
    expect(
      found.some(
        (v) => v.from.endsWith('features/gamma/index.ts') && v.to.endsWith('helpers/tool.ts'),
      ),
    ).toBe(true);
  });

  it('rejects console shared code importing a feature', async () => {
    const found = await violations('console-shared-imports-no-feature');
    expect(found.some((v) => v.from.endsWith('shared/lib/repository/featureLeak.ts'))).toBe(true);
  });

  it('rejects a console feature importing app/', async () => {
    const found = await violations('console-nothing-imports-app');
    expect(found.some((v) => v.from.endsWith('features/subjects/use-cases/appLeak.ts'))).toBe(true);
  });

  it('rejects a console view importing shared/api/transport', async () => {
    const found = await violations('console-view-no-transport');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/ui/SubjectList.tsx') &&
          v.to.endsWith('shared/api/transport/client.ts'),
      ),
    ).toBe(true);
  });

  it('rejects a console view importing shared/api/adapter', async () => {
    const found = await violations('no-view-to-adapter');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/ui/ReadsStorage.tsx') &&
          v.to.endsWith('shared/api/adapter/storage.ts'),
      ),
    ).toBe(true);
  });

  it('rejects a console usecase importing shared/api/adapter', async () => {
    const found = await violations('no-usecase-to-adapter');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/use-cases/readsStorage.ts') &&
          v.to.endsWith('shared/api/adapter/storage.ts'),
      ),
    ).toBe(true);
  });

  it('rejects console shared/api/adapter importing a feature', async () => {
    const found = await violations('console-shared-imports-no-feature');
    expect(found.some((v) => v.from.endsWith('shared/api/adapter/featureLeak.ts'))).toBe(true);
  });

  it('permits a console repository importing shared/api/adapter', async () => {
    const output = await cruiseFixtures();
    const remembers = output.modules.find((m) =>
      m.source.endsWith('shared/lib/repository/remembers.ts'),
    );
    expect(remembers?.dependencies.filter((d) => !d.couldNotResolve)).toHaveLength(1);
    expect(
      output.summary.violations.filter((v) =>
        v.from.endsWith('shared/lib/repository/remembers.ts'),
      ),
    ).toHaveLength(0);
  });

  it('rejects a console usecase reaching shared/api/transport', async () => {
    const found = await violations('console-usecase-no-transport');
    expect(
      found.some((v) => v.from.endsWith('features/subjects/use-cases/readsTransport.ts')),
    ).toBe(true);
  });

  it('rejects the transport context read outside a repository', async () => {
    const found = await violations('console-transport-context-in-repository');
    expect(
      found.some((v) => v.from.endsWith('features/subjects/use-cases/readsTransport.ts')),
    ).toBe(true);
    expect(found.some((v) => v.from.endsWith('repository/readsTransport.ts'))).toBe(false);
  });

  it('rejects the gateway built outside an adapter', async () => {
    const found = await violations('console-transport-client-in-adapter');
    expect(found.some((v) => v.from.endsWith('repository/buildsGateway.ts'))).toBe(true);
    expect(found.some((v) => v.from.endsWith('adapter/buildsGateway.ts'))).toBe(false);
  });

  it('permits a type-only import of the transport anywhere', async () => {
    const output = await cruiseFixtures();
    const typed = output.modules.find((m) => m.source.endsWith('use-cases/typesTransport.ts'));
    expect(typed?.dependencies.filter((d) => !d.couldNotResolve)).toHaveLength(2);
    expect(
      output.summary.violations.filter((v) => v.from.endsWith('use-cases/typesTransport.ts')),
    ).toHaveLength(0);
  });

  it('permits the gallery importing shared/ui and shared/lib/services', async () => {
    const output = await cruiseFixtures();
    const gallery = output.modules.find((m) => m.source.endsWith('src/gallery/Gallery.ts'));
    expect(gallery?.dependencies.filter((d) => !d.couldNotResolve)).toHaveLength(2);
    expect(
      output.summary.violations.filter((v) => v.from.endsWith('src/gallery/Gallery.ts')),
    ).toHaveLength(0);
  });

  it('rejects the gallery importing anything else of the console', async () => {
    const found = await violations('console-gallery-shows-only-view');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('src/gallery/reachesTransport.ts') &&
          v.to.endsWith('shared/api/transport/client.ts'),
      ),
    ).toBe(true);
  });

  it('rejects a console service importing a feature index.ts', async () => {
    const found = await violations('console-service-imports-only-service');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/services.ts') &&
          v.to.endsWith('features/clients/index.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a widget's service importing an entity index.ts for a value", async () => {
    const found = await violations('console-service-entity-index-type-only');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('widgets/shell/services/usesEntityIndex.ts') &&
          v.to.endsWith('entities/session/index.ts'),
      ),
    ).toBe(true);
  });

  it("permits a widget's service importing an entity index.ts for a type", async () => {
    const found = await violations('console-service-entity-index-type-only');
    expect(found.some((v) => v.from.endsWith('widgets/shell/services/usesEntityType.ts'))).toBe(
      false,
    );
  });

  it("permits a widget's service importing the area entity index.ts", async () => {
    const found = await violations('console-service-entity-index-type-only');
    expect(found.some((v) => v.from.endsWith('widgets/shell/services/usesAreaIndex.ts'))).toBe(
      false,
    );
  });

  it("permits a widget's service importing the administrator entity index.ts", async () => {
    const found = await violations('console-service-entity-index-type-only');
    expect(
      found.some((v) => v.from.endsWith('widgets/shell/services/usesAdministratorIndex.ts')),
    ).toBe(false);
  });

  it("permits an entity's service importing its own types", async () => {
    const found = await violations('console-service-imports-only-service');
    expect(found.some((v) => v.from.endsWith('entities/session/services/usesOwnTypes.ts'))).toBe(
      false,
    );
  });

  it("rejects a widget's service importing another widget's index.ts", async () => {
    const found = await violations('console-service-imports-only-service');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('widgets/shell/services/usesWidgetIndex.ts') &&
          v.to.endsWith('widgets/odd/index.ts'),
      ),
    ).toBe(true);
  });

  it('rejects a service topic file importing a feature index.ts, in the folder form', async () => {
    const found = await violations('console-service-imports-only-service');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/services/crossFeature.ts') &&
          v.to.endsWith('features/clients/index.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a service topic file importing another feature's service, in the folder form", async () => {
    const found = await violations('console-feature-imports-only-index');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('features/subjects/services/crossFeature.ts') &&
          v.to.endsWith('features/clients/services/topic.ts'),
      ),
    ).toBe(true);
  });

  it("rejects a console feature's index.ts re-exporting its repository, adapter or shared code", async () => {
    const found = await violations('console-index-exports-view-usecase-service');
    const from = found.filter((v) => v.from.endsWith('features/audit/index.ts'));
    expect(from.map((v) => v.to.replace(/^.*\/src\//u, '')).sort()).toEqual([
      'features/audit/adapter.ts',
      'features/audit/repository.ts',
      'shared/lib/services/capabilities.ts',
    ]);
  });

  it("permits a console feature's index.ts re-exporting its view, usecase and service, and a repository type", async () => {
    const output = await cruiseFixtures();
    const barrel = output.modules.find((m) => m.source.endsWith('features/groups/index.ts'));
    expect(barrel?.dependencies.filter((d) => !d.couldNotResolve)).toHaveLength(4);
    expect(
      output.summary.violations.filter((v) => v.from.endsWith('features/groups/index.ts')),
    ).toHaveLength(0);
  });

  it('rejects console code outside src/testing/ and tests importing src/testing/', async () => {
    const found = await violations('console-nothing-ships-testing');
    const from = found.map((v) => v.from.replace(/^.*\/admin-console\/src\//u, '')).sort();
    expect(from).toEqual(['app/shipsTesting.ts', 'main.tsx']);
  });

  it("rejects app/ importing a feature's internals", async () => {
    const found = await violations('console-feature-imports-only-index');
    expect(
      found.some(
        (v) =>
          v.from.endsWith('src/app/reachesIn.ts') && v.to.endsWith('features/clients/services.ts'),
      ),
    ).toBe(true);
  });

  it("permits app/ importing a feature's index.ts", async () => {
    const output = await cruiseFixtures();
    const router = output.modules.find((m) => m.source.endsWith('src/app/router.ts'));
    expect(router?.dependencies.filter((d) => !d.couldNotResolve)).toHaveLength(1);
    expect(
      output.summary.violations.filter((v) => v.from.endsWith('src/app/router.ts')),
    ).toHaveLength(0);
  });

  it("rejects a widget, entity or page importing another slice's internals", async () => {
    const found = await violations('console-feature-imports-only-index');
    const pairs: [string, string][] = [
      ['widgets/shell/ui/reachesEntityInternals.ts', 'entities/session/services/principal.ts'],
      ['pages/home/ui/reachesWidgetInternals.ts', 'widgets/shell/ui/own.ts'],
    ];
    for (const [from, to] of pairs) {
      expect(found.some((v) => v.from.endsWith(from) && v.to.endsWith(to))).toBe(true);
    }
  });

  it("permits a slice importing another layer's index.ts and its own internals", async () => {
    const output = await cruiseFixtures();
    const clean = [
      'widgets/shell/ui/usesEntityIndex.ts',
      'widgets/shell/ui/Shell.ts',
      'pages/home/ui/usesWidgetIndex.ts',
    ];
    for (const file of clean) {
      expect(output.modules.some((m) => m.source.endsWith(file))).toBe(true);
      expect(output.summary.violations.filter((v) => v.from.endsWith(file))).toHaveLength(0);
    }
  });

  it('rejects a widget, entity or page index.ts publishing an adapter or a helper', async () => {
    const found = await violations('console-index-exports-view-usecase-service');
    expect(
      found.some(
        (v) => v.from.endsWith('entities/odd/index.ts') && v.to.endsWith('adapter/wire.ts'),
      ),
    ).toBe(true);
    expect(
      found.some(
        (v) => v.from.endsWith('widgets/odd/index.ts') && v.to.endsWith('helpers/tool.ts'),
      ),
    ).toBe(true);
    expect(
      found.some((v) => v.from.endsWith('pages/odd/index.ts') && v.to.endsWith('helpers/tool.ts')),
    ).toBe(true);
  });

  it('permits a widget, entity or page index.ts publishing its own services and views', async () => {
    const found = await violations('console-index-exports-view-usecase-service');
    for (const file of [
      'entities/session/index.ts',
      'widgets/shell/index.ts',
      'pages/home/index.ts',
    ]) {
      expect(found.some((v) => v.from.endsWith(file))).toBe(false);
    }
  });

  it('rejects console shared code importing a widget', async () => {
    const found = await violations('console-shared-imports-no-feature');
    expect(found.some((v) => v.from.endsWith('shared/lib/services/reachesWidget.ts'))).toBe(true);
  });

  it('rejects an entity, widget or page importing app/', async () => {
    const found = await violations('console-nothing-imports-app');
    for (const file of ['entities/session/services/reachesApp.ts', 'pages/home/ui/reachesApp.ts']) {
      expect(found.some((v) => v.from.endsWith(file))).toBe(true);
    }
  });

  it('rejects an entity or shared code importing a layer above it', async () => {
    const found = await violations('console-lower-layers-import-no-upper');
    const pairs: [string, string][] = [
      ['entities/session/services/reachesWidget.ts', 'widgets/shell/index.ts'],
      ['entities/session/services/reachesPage.ts', 'pages/home/index.ts'],
      ['entities/session/services/reachesFeature.ts', 'features/clients/index.ts'],
      ['entities/session/services/reachesApp.ts', 'app/router.ts'],
      ['shared/lib/services/reachesWidget.ts', 'widgets/shell/index.ts'],
    ];
    for (const [from, to] of pairs) {
      expect(found.some((v) => v.from.endsWith(from) && v.to.endsWith(to))).toBe(true);
    }
  });

  it('does not hold a feature to the rule for entities and shared code', async () => {
    const found = await violations('console-lower-layers-import-no-upper');
    expect(found.some((v) => v.from.includes('/features/'))).toBe(false);
  });

  it('rejects a widget importing a page, and only a widget', async () => {
    const found = await violations('console-widgets-import-no-page');
    expect(found.map((v) => v.from.replace(/^.*\/src\//u, ''))).toEqual([
      'widgets/shell/ui/reachesPage.ts',
    ]);
  });

  it('rejects a feature importing a page', async () => {
    const found = await violations('console-features-import-no-page');
    expect(found.map((v) => v.from.replace(/^.*\/src\//u, ''))).toEqual([
      'features/picked/reachesPage.ts',
    ]);
  });

  it('rejects a feature importing a widget', async () => {
    const found = await violations('console-features-import-no-widget');
    expect(found.map((v) => v.from.replace(/^.*\/src\//u, ''))).toEqual([
      'features/picked/reachesWidget.ts',
    ]);
  });

  it('rejects console code importing the gallery', async () => {
    const found = await violations('console-nothing-imports-gallery');
    expect(found.some((v) => v.from.endsWith('shared/lib/repository/galleryLeak.ts'))).toBe(true);
  });
});
