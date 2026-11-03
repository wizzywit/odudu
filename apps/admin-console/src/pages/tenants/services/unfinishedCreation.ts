import type { Creation } from '#/entities/creation-draft';

// A subject created but not finished, which starting over would drop.
export interface Unfinished {
  tenant: string;
  username: string;
  // Whether tenant-admin landed, leaving only the one-time password.
  granted: boolean;
}

export function unfinishedOf(creation: Creation): Unfinished | null {
  if (creation.step !== 'administrator' || creation.subjectId === null) return null;
  return { tenant: creation.tenant, username: creation.username, granted: creation.granted };
}
