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
      to: { path: '(^|/)packages/protocol-(?!\\1)[^/]+/' },
    },
    // Layer paths use lookaheads, not `/src/(.+/)?view/`: dependency-cruiser's
    // safe-regex check rejects any optional group wrapping a quantifier
    // (star height > 1) regardless of whether it is actually catastrophic,
    // and `(.+/)?` is exactly that shape. Two independent lookaheads keep
    // "somewhere under src" and "a `view` segment" as sibling checks instead
    // of nesting one repetition inside another.
    {
      name: 'no-view-to-repository',
      severity: 'error',
      from: { path: '(?=.*/src/)(?=.*/view/)' },
      to: { path: '(?=.*/src/)(?=.*/repository/)' },
    },
    {
      name: 'no-view-to-adapter',
      severity: 'error',
      from: { path: '(?=.*/src/)(?=.*/view/)' },
      to: { path: '(?=.*/src/)(?=.*/adapter/)' },
    },
    {
      name: 'no-usecase-to-adapter',
      severity: 'error',
      from: { path: '(?=.*/src/)(?=.*/usecase/)' },
      to: { path: '(?=.*/src/)(?=.*/adapter/)' },
    },
    {
      name: 'service-is-a-leaf',
      severity: 'error',
      comment: 'service holds domain logic and depends on no other layer.',
      from: { path: '(?=.*/src/)(?=.*/service/)' },
      to: { path: '(?=.*/src/)(?=.*/(?:view|usecase|repository|adapter)/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
};
