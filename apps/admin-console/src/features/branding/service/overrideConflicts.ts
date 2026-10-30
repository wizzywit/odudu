import type { MessageOverride } from '@odudu/contracts/admin';
import type { Conflict } from '#/shared/service/conflict';
import type { GatewayResult } from '#/shared/service/result';
import {
  EMPTY_OVERRIDE,
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

export function conflictFields(conflict: OverrideConflict): Conflict[] {
  return [
    {
      field: 'message',
      label: 'Text',
      theirs: conflict.theirs,
      yours: conflict.mine,
      secret: false,
    },
  ];
}

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
