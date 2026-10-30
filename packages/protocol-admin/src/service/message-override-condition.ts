import { etagOf, hasPrecondition, matches } from '#/service/etag';

export interface EtagSource {
  readonly locale: string;
  readonly key: string;
  readonly message: string;
  readonly updatedAt: Date;
}

// The validator of one override, quoted as it is sent in `ETag` and
// `If-Match`. It includes the write time to the millisecond, so a change back
// to earlier text is a new version unless it lands in the same millisecond.
export function messageOverrideEtag(row: EtagSource): string {
  return etagOf({
    locale: row.locale,
    key: row.key,
    message: row.message,
    updated_at: row.updatedAt.toISOString(),
  });
}

export type OverrideCondition =
  | { readonly kind: 'create' }
  | { readonly kind: 'replace'; readonly ifMatch: string }
  | { readonly kind: 'required' };

// A write names the version it read, or says it expects there to be none.
// `*` as `If-Match` names no version, so like an absent header it is `required`.
export function overrideCondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined,
): OverrideCondition {
  if (ifNoneMatch?.trim() === '*' && ifMatch === undefined) return { kind: 'create' };
  if (ifNoneMatch === undefined && hasPrecondition(ifMatch) && ifMatch !== undefined) {
    // The second test only narrows the type; hasPrecondition already rules out undefined.
    return { kind: 'replace', ifMatch };
  }
  return { kind: 'required' };
}

export function overrideConditionHolds(
  condition: Exclude<OverrideCondition, { kind: 'required' }>,
  stored: EtagSource | null,
): boolean {
  if (condition.kind === 'create') return stored === null;
  return stored !== null && matches(condition.ifMatch, messageOverrideEtag(stored)) === 'match';
}
