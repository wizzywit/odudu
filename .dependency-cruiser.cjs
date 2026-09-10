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
        'Users do not know what OIDC is. This is what lets SAML arrive without touching identity.',
      from: { path: '(^|/)packages/domain-[^/]+/' },
      to: { path: '(^|/)packages/protocol-[^/]+/' },
    },
    {
      name: 'no-protocol-to-protocol',
      severity: 'error',
      comment: 'Protocols stay independently testable and independently deletable.',
      from: { path: '(^|/)packages/protocol-([^/]+)/' },
      to: { path: '(^|/)packages/protocol-(?!$2/)[^/]+/' },
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
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
};
