import type { MessageOverride } from '@odudu/contracts/admin';
import { describeValue, type Conflict } from '#/shared/service/conflict';
import type { GatewayResult } from '#/shared/service/result';
import {
  EMPTY_OVERRIDE,
  overrideFailure,
  type OverrideValues,
  type SentOverride,
} from '#/features/branding/service/overrides';

// An edit that met a newer version of the same override: what the person
// meant to save, and what the server holds now, which is null when it holds
// none any more.
export interface OverrideConflict {
  locale: string;
  key: string;
  mine: string;
  theirs: string | null;
  // The version to send to save over theirs; null creates it again.
  theirsEtag: string | null;
}

export function overrideConflict(
  sent: Pick<SentOverride, 'locale' | 'key' | 'message'>,
  theirs: Pick<MessageOverride, 'message' | 'etag'> | null,
): OverrideConflict {
  return {
    locale: sent.locale,
    key: sent.key,
    mine: sent.message,
    theirs: theirs?.message ?? null,
    theirsEtag: theirs?.etag ?? null,
  };
}

export const CONFLICT_TEXT_LABEL = 'Text';

export const OVERRIDE_CONFLICT_LEAD =
  'Somebody else saved this override while you were editing it. Nothing has been merged.';

export const OVERRIDE_REMOVED_LEAD =
  'Somebody else removed this override while you were editing it. Keep mine creates it again with your text; Take theirs leaves it removed.';

// What the server holds now, said as removed when it holds nothing.
function describeTheirs(value: unknown): string {
  return value === null ? 'removed' : describeValue(value);
}

export function conflictFields(conflict: OverrideConflict): Conflict[] {
  return [
    {
      field: 'message',
      label: CONFLICT_TEXT_LABEL,
      theirs: conflict.theirs,
      yours: conflict.mine,
      secret: false,
      describe: describeTheirs,
    },
  ];
}

export function conflictLead(conflict: OverrideConflict): string {
  return conflict.theirs === null ? OVERRIDE_REMOVED_LEAD : OVERRIDE_CONFLICT_LEAD;
}

// What the save did to the conflicts held: an override that was saved has none.
export function conflictsAfterSave(
  held: readonly OverrideConflict[],
  sent: Pick<OverrideConflict, 'locale' | 'key'>,
  saved: boolean,
): readonly OverrideConflict[] {
  return saved ? withoutConflict(held, sent) : held;
}

// Said when a save, or the read after it, ended without an answer.
export const SAVE_INTERRUPTED = overrideFailure({ ok: false, kind: 'defect' }).message ?? '';

// Named as the panel's heading reads: "Changed in the en text for login.title".
export function conflictSection(conflict: OverrideConflict): string {
  return `the ${conflict.locale} text for ${conflict.key}`;
}

export function keepMine(conflict: OverrideConflict): SentOverride {
  return {
    locale: conflict.locale,
    key: conflict.key,
    message: conflict.mine,
    etag: conflict.theirsEtag,
  };
}

function sameOverride(a: OverrideConflict, b: Pick<OverrideConflict, 'locale' | 'key'>): boolean {
  return a.locale === b.locale && a.key === b.key;
}

export function withConflict(
  held: readonly OverrideConflict[],
  conflict: OverrideConflict,
): OverrideConflict[] {
  return [...held.filter((one) => !sameOverride(one, conflict)), conflict];
}

export function withoutConflict(
  held: readonly OverrideConflict[],
  gone: Pick<OverrideConflict, 'locale' | 'key'>,
): OverrideConflict[] {
  return held.filter((one) => !sameOverride(one, gone));
}

// Taking theirs drops the edit, so a form still holding it is emptied.
export function formAfterTakingTheirs(
  values: OverrideValues,
  taken: Pick<OverrideConflict, 'key'>,
): OverrideValues {
  return values.key.trim() === taken.key ? EMPTY_OVERRIDE : values;
}

// What the form holds once a save has been answered: emptied if it carried
// what was saved, left alone otherwise.
export function formAfterSave(
  values: OverrideValues,
  sent: Pick<SentOverride, 'key'>,
  saved: boolean,
): OverrideValues {
  return saved ? formAfterTakingTheirs(values, sent) : values;
}

// The conflicts of the language shown; another language's wait for it.
export function conflictsIn(held: readonly OverrideConflict[], locale: string): OverrideConflict[] {
  return held.filter((one) => one.locale === locale);
}

export const UNREAD_NEWER =
  'That override changed elsewhere since you opened it, and its newer text could not be loaded. Nothing was saved; look at the list, then save again.';

export interface StaleOutcome {
  conflict: OverrideConflict | null;
  message: string | null;
}

// What a 412 comes to once the override's current text has been read: the
// comparison to show, or why there is none.
export function staleOutcome(
  sent: Pick<SentOverride, 'locale' | 'key' | 'message'>,
  current: GatewayResult<MessageOverride | null>,
): StaleOutcome {
  if (!current.ok) return { conflict: null, message: UNREAD_NEWER };
  return { conflict: overrideConflict(sent, current.data), message: null };
}
