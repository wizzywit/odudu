import { type Invariant } from '@odudu/domain-agents';

export type MintInvariant = Invariant | 'live_instances_exceeded';

export interface MayActActor {
  sub: string;
  iss: string;
}

// RFC 8693 §4.4's `may_act` is one object. A subject who authorises several
// actors gets a list of them, which `mayActPermits` reads the same way.
export function mayActClaim(
  actors: readonly string[],
  issuer: string,
): MayActActor | MayActActor[] | undefined {
  const named = [...new Set(actors)].sort();
  const [only, ...rest] = named;
  if (only === undefined) return undefined;
  if (rest.length === 0) return { sub: only, iss: issuer };
  return named.map((sub) => ({ sub, iss: issuer }));
}

// What the subject's delegations to one actor allow together: any of them
// authorises the actor, so the ceiling is their union. Null is no ceiling.
export function narrowestCeiling(ceilings: readonly string[]): string[] | null {
  if (ceilings.length === 0) return null;
  return [...new Set(ceilings.flatMap((ceiling) => ceiling.split(' ').filter((s) => s !== '')))];
}

export function normaliseScope(scope: readonly string[]): string[] | null {
  if (scope.length === 0) return null;
  if (scope.some((entry) => entry === '' || entry.includes(' '))) return null;
  return [...new Set(scope)];
}

export function instanceExpiry(input: {
  now: Date;
  ttlSeconds: number;
  parentExpiresAt: Date;
  sessionEndsAt: Date | null;
}): Date {
  const bounds = [
    input.now.getTime() + input.ttlSeconds * 1000,
    input.parentExpiresAt.getTime(),
    ...(input.sessionEndsAt === null ? [] : [input.sessionEndsAt.getTime()]),
  ];
  return new Date(Math.min(...bounds));
}

export type MintRefusalError = 'invalid_request' | 'invalid_target' | 'invalid_scope';

// The OAuth answer for an invariant the mint refused. A caller never learns
// more than the invariant's name, and no row of another tenant is involved.
export function mintRefusal(invariant: MintInvariant): { error: MintRefusalError } {
  switch (invariant) {
    case 'scope_widened':
      return { error: 'invalid_scope' };
    case 'ttl_exceeds_parent':
    case 'ttl_exceeds_session':
      return { error: 'invalid_request' };
    case 'depth_exceeded':
    case 'fanout_exceeded':
    case 'live_instances_exceeded':
      return { error: 'invalid_target' };
  }
}
