import { createHash } from 'node:crypto';
import { type Invariant } from '@odudu/domain-agents';

export type MintInvariant =
  | Invariant
  | 'live_instances_exceeded'
  | 'parent_not_live'
  | 'invalid_expiry'
  | 'actor_not_permitted';

export interface MayActActor {
  sub: string;
  iss: string;
}

export type MayActClaim = MayActActor | MayActActor[];

// RFC 8693 §4.4's `may_act` is one object. A subject who authorises several
// actors gets a list of them, which `mayActPermits` reads the same way.
export function mayActClaim(actors: readonly string[], issuer: string): MayActClaim | undefined {
  const named = [...new Set(actors)].sort();
  const [only, ...rest] = named;
  if (only === undefined) return undefined;
  if (rest.length === 0) return { sub: only, iss: issuer };
  return named.map((sub) => ({ sub, iss: issuer }));
}

// What the subject's delegations to one actor allow together. Separate
// delegations are separate permissions, so the ceiling is their union, and
// the client's own configuration sets no ceiling of its own. Null is none.
export function combinedCeiling(ceilings: readonly string[]): string[] | null {
  if (ceilings.length === 0) return null;
  return [...new Set(ceilings.flatMap((ceiling) => ceiling.split(' ').filter((s) => s !== '')))];
}

// The id of the instance for one run of an owner's grant, derived so that the
// same run finds its instance again and two grants never share one. The
// fields are hashed as a JSON array so a key cannot shift into its neighbour.
export function runInstanceId(tenantId: string, grantId: string, key: string): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify([tenantId, grantId, key]))
    .digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function normaliseScope(scope: readonly string[]): string[] | null {
  if (scope.length === 0) return null;
  if (scope.some((entry) => entry === '' || entry.includes(' '))) return null;
  return [...new Set(scope)];
}

// Null when any input is not a usable time: every comparison with an Invalid
// Date is false, so one would be admitted by a check written as `a > b`.
export function instanceExpiry(input: {
  now: Date;
  ttlSeconds: number;
  parentExpiresAt: Date;
  sessionEndsAt: Date | null;
}): Date | null {
  const usable =
    Number.isFinite(input.ttlSeconds) &&
    input.ttlSeconds > 0 &&
    [input.now, input.parentExpiresAt, input.sessionEndsAt].every(
      (time) => time === null || Number.isFinite(time.getTime()),
    );
  if (!usable) return null;
  const bounds = [
    input.now.getTime() + input.ttlSeconds * 1000,
    input.parentExpiresAt.getTime(),
    ...(input.sessionEndsAt === null ? [] : [input.sessionEndsAt.getTime()]),
  ];
  return new Date(Math.min(...bounds));
}

export type MintRefusalError =
  'invalid_request' | 'invalid_target' | 'invalid_scope' | 'access_denied';

// The OAuth answer for an invariant the mint refused. A caller never learns
// more than the invariant's name, and no row of another tenant is involved.
export function mintRefusal(invariant: MintInvariant): { error: MintRefusalError } {
  switch (invariant) {
    case 'scope_widened':
      return { error: 'invalid_scope' };
    case 'parent_not_live':
    case 'invalid_expiry':
    case 'ttl_exceeds_parent':
    case 'ttl_exceeds_session':
      return { error: 'invalid_request' };
    case 'actor_not_permitted':
      return { error: 'access_denied' };
    case 'depth_exceeded':
    case 'fanout_exceeded':
    case 'live_instances_exceeded':
      return { error: 'invalid_target' };
  }
}

// A stored or presented `may_act` read back as a claim. Anything that is not
// one this issuer writes becomes an empty list, which permits no actor, so a
// damaged value narrows to refusal rather than to no restriction.
export function narrowMayAct(value: unknown): MayActClaim | undefined {
  if (value === null || value === undefined) return undefined;
  const actor = (entry: unknown): MayActActor | null => {
    if (typeof entry !== 'object' || entry === null) return null;
    const { sub, iss } = entry as { sub?: unknown; iss?: unknown };
    return typeof sub === 'string' && typeof iss === 'string' ? { sub, iss } : null;
  };
  if (Array.isArray(value)) {
    const actors = value.map(actor);
    return actors.every((entry) => entry !== null) ? actors : [];
  }
  return actor(value) ?? [];
}

// Whether the exchanging client may act, from what is live now rather than
// from the `may_act` a token or grant carries. A claim naming the actor with
// no live source behind it is refused: the source was revoked or lapsed, and
// treating that as "no ceiling" would widen the scope the delegation bounded.
// A null ceiling means the client configuration alone names the actor.
export function actorAdmission(input: {
  namedByConfig: boolean;
  ceilings: readonly string[];
  liveActors: number;
  claimPresent: boolean;
}): { kind: 'ok'; ceiling: string[] | null } | { kind: 'refused' } {
  if (input.ceilings.length > 0) return { kind: 'ok', ceiling: combinedCeiling(input.ceilings) };
  if (input.namedByConfig) return { kind: 'ok', ceiling: null };
  if (input.liveActors === 0 && !input.claimPresent) return { kind: 'ok', ceiling: null };
  return { kind: 'refused' };
}
