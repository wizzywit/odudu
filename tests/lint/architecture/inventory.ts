import type { RuleId } from './rule.ts';

export const INVENTORY: Record<RuleId, string[]> = {
  'no-service-barrel': [],
  'no-domain-in-shared': [],
  'no-sideways-slice': [],
  'view-no-service': [
    'apps/docs/src/features/code-block/ui/Highlight/Highlight.tsx',
    'apps/docs/src/features/landing/ui/Install/Install.tsx',
    'apps/docs/src/features/landing/ui/Scene/Scene.tsx',
    'apps/docs/src/features/landing/ui/SignInFlow/SignInFlow.tsx',
    'apps/docs/src/features/not-found/ui/NotFoundPage/NotFoundPage.tsx',
  ],
  'no-adapter-export': [],
  'contracts-only-in-adapter': [],
};
