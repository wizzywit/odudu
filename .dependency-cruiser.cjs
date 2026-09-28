/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cycles make packages impossible to reason about or delete independently.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-domain-to-protocol',
      severity: 'error',
      comment:
        'Users do not know what OIDC is. This is what lets SAML arrive without touching identity. ' +
        '@odudu/account carries the same restriction: registration, verification and reset are ' +
        'account lifecycle, not OIDC.',
      from: { path: '(^|/)packages/(?:domain-[^/]+|account|email)/' },
      to: { path: '(^|/)packages/protocol-[^/]+/' },
    },
    {
      name: 'no-domain-to-authn-flows',
      severity: 'error',
      comment:
        'The umbrella spec (section 3) fixes the dependency direction as authn-flows depending ' +
        'on the domain packages, not the reverse: authn-flows already depends on ' +
        '@odudu/domain-identity, so an edge back from a domain package would be a cycle waiting ' +
        'to happen and puts a login concern underneath the identities it authenticates. A domain ' +
        'package that needs to provision a flow is provisioned by its own caller instead — see ' +
        'provisionBrowserFlow in @odudu/authn-flows and provisionTenantDefaults in ' +
        '@odudu/domain-tenant, called side by side by whatever stands up a tenant.',
      from: { path: '(^|/)packages/(?:domain-[^/]+|account|email)/' },
      to: { path: '(^|/)packages/authn-flows/' },
    },
    {
      name: 'console-gateway-imports-no-protocol',
      severity: 'error',
      comment:
        'The console gateway is a backend-for-frontend under /console; it never reaches a ' +
        'protocol implementation or a login-flow rendering package directly.',
      from: { path: '(^|/)packages/console-gateway/' },
      to: { path: '(^|/)packages/(?:protocol-|authn-flows)[^/]*/' },
    },
    {
      name: 'console-gateway-allowlist',
      severity: 'error',
      comment:
        'The console gateway reaches the server only as an OAuth client does, so of the ' +
        'workspace it may import the kernel, db, crypto, contracts, domain-tenant and ' +
        'domain-identity packages and nothing else. The rule covers src/ minus its *.test.ts ' +
        'files; those and everything under tests/ are held only by ' +
        'console-gateway-imports-no-protocol, so they may import any package but the ' +
        'protocol packages and authn-flows.',
      from: {
        path: '(^|/)packages/console-gateway/src/',
        pathNot: '\\.test\\.ts$',
      },
      to: {
        path: '(^|/)packages/',
        pathNot:
          '(^|/)node_modules/|(^|/)packages/(?:console-gateway|kernel|db|crypto|contracts|domain-tenant|domain-identity)/',
      },
    },
    {
      name: 'console-feature-imports-only-index',
      severity: 'error',
      comment:
        "A console feature's index.ts is its only importable surface; everything else in it " +
        'can change without another feature noticing.',
      from: { path: '(^|/)apps/admin-console/src/features/([^/]+)/' },
      // $2 is substituted unescaped; tests/lint/console-feature-names.test.ts keeps it regex-safe.
      to: { path: '(^|/)apps/admin-console/src/features/(?!$2/)[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'console-shared-imports-no-feature',
      severity: 'error',
      comment: 'shared/ holds only what two or more features use, so it depends on none of them.',
      from: { path: '(^|/)apps/admin-console/src/shared/' },
      to: { path: '(^|/)apps/admin-console/src/features/' },
    },
    {
      name: 'console-nothing-imports-app',
      severity: 'error',
      comment:
        'app/ is the composition root. With console-feature-imports-only-index it is the one ' +
        "place that sees every feature's index.ts together, and nothing below it sees app/.",
      from: { path: '(^|/)apps/admin-console/src/(?:shared|features)/' },
      to: { path: '(^|/)apps/admin-console/src/app/' },
    },
    {
      name: 'console-view-no-transport',
      severity: 'error',
      comment:
        'A console view reaches the gateway and the cross-feature stores only through a usecase.',
      from: { path: '(^|/)apps/admin-console/src/(?:view|.*/view)(?:/|\\.tsx?$)' },
      to: { path: '(^|/)apps/admin-console/src/shared/(?:transport|repository)/' },
    },
    {
      name: 'console-nothing-imports-gallery',
      severity: 'error',
      comment:
        'gallery/ is a development-only entry that the production build never reaches; ' +
        'anything that imported it would drag it into the bundle.',
      from: { path: '(^|/)apps/admin-console/src/(?:app|shared|features)/' },
      to: { path: '(^|/)apps/admin-console/src/gallery/' },
    },
    {
      name: 'console-gallery-shows-only-view',
      severity: 'error',
      comment:
        'The gallery renders the design system with sample data, so it needs shared/view and ' +
        'the pure rules in shared/service, and never a store, the transport or a feature.',
      from: { path: '(^|/)apps/admin-console/src/gallery/' },
      to: {
        path: '(^|/)apps/admin-console/src/',
        pathNot: '(^|/)apps/admin-console/src/(?:gallery|shared/view|shared/service)/',
      },
    },
    {
      name: 'no-server-to-testing',
      severity: 'error',
      comment:
        "apps/server/src/testing/ holds the server's integration-test harness; nothing it " +
        'ships may depend on it.',
      from: {
        path: '(^|/)apps/server/src/',
        pathNot: '(^|/)apps/server/src/testing/|\\.test\\.ts$',
      },
      to: { path: '(^|/)apps/server/src/testing/' },
    },
    {
      name: 'no-protocol-to-protocol',
      severity: 'error',
      comment:
        'Protocols stay independently deletable. protocol-admin is exempt as a source — it is ' +
        'downstream of the protocol surface by definition (ADR 0035); the reverse edge below ' +
        'forbids it becoming a two-way door.',
      from: { path: '(^|/)packages/protocol-([^/]+)/', pathNot: '(^|/)packages/protocol-admin/' },
      to: { path: '(^|/)packages/protocol-(?!$2/)[^/]+/' },
    },
    {
      name: 'no-protocol-to-admin',
      severity: 'error',
      comment: 'The admin API may import a protocol package; the reverse is never allowed.',
      from: { path: '(^|/)packages/protocol-(?!admin/)[^/]+/' },
      to: { path: '(^|/)packages/protocol-admin/' },
    },
    {
      name: 'no-admin-to-other-protocol',
      severity: 'error',
      comment:
        'The admin API is downstream of OIDC only (ADR 0035), not protocols generally — reaching ' +
        'another one is a decision to make deliberately.',
      from: { path: '(^|/)packages/protocol-admin/' },
      to: { path: '(^|/)packages/protocol-(?!oidc/|admin/)[^/]+/' },
    },
    // `/src/(.+/)?view/` fails dependency-cruiser's safe-regex check (star
    // height > 1: the optional group wraps a quantifier). The alternation
    // below is unquantified, so it stays star-height 1 while still matching
    // `view` directly under `src` or nested arbitrarily deep beneath it, in
    // that left-to-right order. The trailing group holds a single-file layer,
    // `view.tsx` beside `adapter.ts`, to the same rules as a layer folder.
    {
      name: 'no-view-to-repository',
      severity: 'error',
      from: { path: '/src/(?:view|.*/view)(?:/|\\.tsx?$)' },
      to: { path: '/src/(?:repository|.*/repository)(?:/|\\.tsx?$)' },
    },
    {
      name: 'no-view-to-adapter',
      severity: 'error',
      from: { path: '/src/(?:view|.*/view)(?:/|\\.tsx?$)' },
      to: { path: '/src/(?:adapter|.*/adapter)(?:/|\\.tsx?$)' },
    },
    {
      name: 'no-usecase-to-adapter',
      severity: 'error',
      from: { path: '/src/(?:usecase|.*/usecase)(?:/|\\.tsx?$)' },
      to: { path: '/src/(?:adapter|.*/adapter)(?:/|\\.tsx?$)' },
    },
    {
      name: 'service-is-a-leaf',
      severity: 'error',
      comment: 'service holds domain logic and depends on no other layer.',
      from: { path: '/src/(?:service|.*/service)(?:/|\\.tsx?$)' },
      to: {
        path: '/src/(?:(?:view|usecase|repository|adapter)|.*/(?:view|usecase|repository|adapter))(?:/|\\.tsx?$)',
      },
    },
    {
      name: 'no-layer-to-testing',
      severity: 'error',
      comment:
        "`src/testing/` holds fixtures reused across a package's own test files, reachable " +
        'only via `#/` because ESLint forbids relative test imports and `#/*` maps to ' +
        '`./src/*.ts` (see packages/protocol-oidc/src/testing/). None of the five layers has a ' +
        'legitimate reason to depend on test-only code; a test beside one is not layer code.',
      from: {
        path: '/src/(?:(?:view|usecase|repository|adapter|service)|.*/(?:view|usecase|repository|adapter|service))(?:/|\\.tsx?$)',
        pathNot: '\\.test\\.tsx?$',
      },
      to: { path: '/src/(?:testing|.*/testing)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
};
