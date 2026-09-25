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
    // that left-to-right order.
    {
      name: 'no-view-to-repository',
      severity: 'error',
      from: { path: '/src/(?:view|.*/view)/' },
      to: { path: '/src/(?:repository|.*/repository)/' },
    },
    {
      name: 'no-view-to-adapter',
      severity: 'error',
      from: { path: '/src/(?:view|.*/view)/' },
      to: { path: '/src/(?:adapter|.*/adapter)/' },
    },
    {
      name: 'no-usecase-to-adapter',
      severity: 'error',
      from: { path: '/src/(?:usecase|.*/usecase)/' },
      to: { path: '/src/(?:adapter|.*/adapter)/' },
    },
    {
      name: 'service-is-a-leaf',
      severity: 'error',
      comment: 'service holds domain logic and depends on no other layer.',
      from: { path: '/src/(?:service|.*/service)/' },
      to: {
        path: '/src/(?:(?:view|usecase|repository|adapter)|.*/(?:view|usecase|repository|adapter))/',
      },
    },
    {
      name: 'no-layer-to-testing',
      severity: 'error',
      comment:
        "`src/testing/` holds fixtures reused across a package's own test files, reachable " +
        'only via `#/` because ESLint forbids relative test imports and `#/*` maps to ' +
        '`./src/*.ts` (see packages/protocol-oidc/src/testing/). None of the five layers has a ' +
        'legitimate reason to depend on test-only code.',
      from: {
        path: '/src/(?:(?:view|usecase|repository|adapter|service)|.*/(?:view|usecase|repository|adapter|service))/',
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
