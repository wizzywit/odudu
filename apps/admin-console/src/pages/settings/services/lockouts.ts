import type { AdminCapability } from '#/shared/lib/services/principal';

export const LOCKOUTS_NEEDS: AdminCapability = 'manage-users';

export const CLEAR_HEADING = 'Clear all lockouts';

export const CLEAR_RULE =
  'Forgets every failed sign-in on record in this tenant at once, for accounts that are locked and for accounts still counting toward a lockout. One account’s lockout is cleared on that subject’s own page.';
