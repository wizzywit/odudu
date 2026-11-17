import { flag } from '#/cli/command-types';

export const RECONCILE_OPTIONS = {
  'dry-run': flag(
    'Find the accounts that hold one address apart from its case and say what would be done, ' +
      'without changing anything.',
  ),
} as const;
