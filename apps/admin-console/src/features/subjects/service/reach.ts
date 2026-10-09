import { type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import {
  beyondCaller,
  heldCapabilities,
  type Held,
  type Holding,
} from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import { type AdminCapability } from '#/shared/service/principal.ts';
import { type Loaded } from '#/features/subjects/service/create.ts';

export function heldOf(
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
): ReadonlyMap<Holding, Held> {
  return effective.status === 'ready' ? heldCapabilities(effective.data.items) : new Map();
}

// Admin capabilities the subject holds and the caller does not (ADR 0040's
// target ceiling); none until both are known.
export function subjectBeyond(
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
  caller: readonly AdminCapability[] | undefined,
): AdminCapability[] {
  return caller === undefined ? [] : beyondCaller([...heldOf(effective).keys()], caller);
}

export function canManageSubject(
  lacking: readonly AdminCapability[],
  effective: Loaded<unknown>['status'],
  beyond: readonly AdminCapability[],
): boolean {
  return lacking.length === 0 && effective === 'ready' && beyond.length === 0;
}

export function reachOf(
  effective: Loaded<unknown>,
): 'checking' | 'ready' | { failed: true; retry: () => void } {
  switch (effective.status) {
    case 'ready':
      return 'ready';
    case 'loading':
      return 'checking';
    case 'failed':
      return { failed: true, retry: effective.retry };
  }
}

// `view` is the line a record carries in place of every write the server
// would refuse; `change` is the one inside the capability editor.
export function beyondText(
  name: string,
  beyond: readonly string[],
  mode: 'change' | 'view',
): string {
  const holds = `${name} holds ${andList(beyond)}, which you do not, so you`;
  return mode === 'change'
    ? `${holds} cannot change what ${name} holds.`
    : `${holds} can view ${name} but change nothing here.`;
}
