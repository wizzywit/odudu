import { blockedChanges, lacking, type Change } from '#/shared/services/access';
import { SYSTEM_TENANT, type AdminCapability, type Authority } from '#/shared/services/principal';
import { administratorNeeds, GRANT_NEEDS } from '#/entities/administrator';

const CREATING = administratorNeeds(SYSTEM_TENANT, { subjectId: null, granted: false });

export interface AdministratorsAccess {
  createNeeds: readonly AdminCapability[];
  // What changing anybody's capabilities needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  blocked: Change | null;
}

export function administratorsAccess(authority: Authority | undefined): AdministratorsAccess {
  return {
    createNeeds: lacking(authority, CREATING),
    changeNeeds: lacking(authority, ['manage-users']),
    blocked: blockedChanges(authority, [
      { change: 'create them', needs: CREATING },
      { change: 'change what they hold', needs: GRANT_NEEDS },
    ]),
  };
}
