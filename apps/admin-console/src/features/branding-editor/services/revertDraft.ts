import type { ThemeBody, ThemeView } from '#/features/branding-editor/types/theme';
import type { ThemeBodyRequest } from '@odudu/contracts';
import type { Conflict } from '#/shared/lib/services/conflict';
import { isStale, writeFailureText } from '#/shared/lib/services/failure';
import { counted } from '#/shared/lib/services/format';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';
import { unsavedSections } from '#/features/branding-editor/services/sectionTitles';
import { unsavedBlock } from '#/features/branding-editor/services/unsavedBlock';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import {
  BRANDING_TAB_SECTIONS,
  type BrandingTab,
  type ScopedTab,
} from '#/features/branding-editor/services/tabs';
import { EMPTY_BODY, baseBody } from '#/features/branding-editor/services/themeBody';
import {
  TAB_PIECES,
  type ChangedPiece,
  PIECE_TITLES,
} from '#/features/branding-editor/services/changeSummary';

export const REVERT_TITLE = 'Revert to published';

export const REVERT_LABEL = 'Revert this tab to published';

export const REVERTING = 'Reverting…';

export const REVERT_DONE = 'Tab reverted to published';

const TAB_PARTS: Readonly<Record<ScopedTab, string>> = {
  theme: 'the colours and font, the images and the stylesheet',
  pages: 'the page templates',
};

export function revertLead(scope: ThemeScope, tab: ScopedTab): string {
  const under = scope.kind === 'tenant' ? 'is cleared' : 'falls back to the tenant’s theme';
  return `Writes the draft again with ${TAB_PARTS[tab]} as published, all together; a part with nothing published ${under}. The other tabs keep their changes, and nothing is published.`;
}

export const TAB_MATCHES = 'This tab already matches what is published.';

export function revertUnsaved(sections: readonly string[]): string {
  return unsavedBlock(sections, 'reverting works on the saved draft');
}

// The sections of one tab holding unsaved edits.
export function tabUnsaved(tab: BrandingTab, dirty: ReadonlySet<string>): readonly string[] {
  return unsavedSections(
    new Set([...dirty].filter((id) => BRANDING_TAB_SECTIONS[tab].includes(id))),
  );
}

export function revertHold({
  view,
  tab,
  unsaved,
}: {
  view: ThemeView;
  tab: ScopedTab;
  unsaved: readonly string[];
}): string | undefined {
  if (unsaved.length > 0) return revertUnsaved(unsaved);
  const holds = TAB_PIECES[tab].some((piece) => view.changed.includes(piece));
  return holds ? undefined : TAB_MATCHES;
}

const PIECE_OF: Readonly<Record<ChangedPiece, (body: ThemeBody) => Partial<ThemeBody>>> = {
  tokens: (body) => ({ tokens: body.tokens }),
  assets: (body) => ({ assets: body.assets }),
  stylesheet: (body) => ({ stylesheet: body.stylesheet }),
  templates: (body) => ({ templates: body.templates }),
};

// The draft written again with a tab's pieces as the scope's own published
// theme has them, or empty where it has none; every other piece stays.
export function revertRequest(view: ThemeView, tab: ScopedTab): ThemeBodyRequest {
  const published = view.published?.body ?? EMPTY_BODY;
  return TAB_PIECES[tab].reduce<ThemeBodyRequest>(
    (body, piece) => ({ ...body, ...PIECE_OF[piece](published) }),
    baseBody(view),
  );
}

export function revertFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The tab',
    verb: 'reverted',
    lookAt: 'the draft above',
    stale:
      'Somebody saved the draft after you opened it. The page now shows their version: look it over, then revert if you still want to.',
  });
}

// What a revert's answer says under the button: nothing when it went through.
export function revertProblem(result: GatewayResult<unknown>): string | null {
  return result.ok ? null : revertFailure(result);
}

// What a revert answered, kept with the tab it reverted: the answer is shown
// on that tab only, since the bar's panel is one and the tab under it changes.
export interface RevertAnswer {
  tab: ScopedTab;
  problem: string | null;
  stale: boolean;
}

export function revertAnswered(tab: ScopedTab, result: GatewayResult<unknown>): RevertAnswer {
  return { tab, problem: revertProblem(result), stale: isStale(result) };
}

// A revert whose send threw: told as a defect, with nothing to compare.
export function revertDefected(tab: ScopedTab): RevertAnswer {
  return { tab, problem: revertFailure({ ok: false, kind: 'defect' }), stale: false };
}

export function revertAnswerOf(
  answer: RevertAnswer | null,
  tab: ScopedTab,
): { problem: string | null; stale: boolean } {
  return answer?.tab === tab
    ? { problem: answer.problem, stale: answer.stale }
    : { problem: null, stale: false };
}

// How a revert's panel names the tab it concerns, as its heading reads it.
export function revertSection(tab: ScopedTab): string {
  return tab === 'theme' ? 'the Theme tab' : 'the Pages tab';
}

const PIECE_UNITS: Readonly<Record<ChangedPiece, readonly [string, string]>> = {
  tokens: ['group of colours or fonts', 'groups of colours or fonts'],
  assets: ['image', 'images'],
  stylesheet: ['character', 'characters'],
  templates: ['page template', 'page templates'],
};

const NAMED_AT_MOST = 3;

const PREVIEW_LENGTH = 24;

// What a piece holds, short enough for a table cell but enough to tell two
// of the same size apart: the names it sets, or how a stylesheet begins.
function describePiece(piece: ChangedPiece): (value: unknown) => string {
  const [one, other] = PIECE_UNITS[piece];
  return (value) => {
    if (value === null || value === undefined || value === '') return 'nothing';
    if (typeof value === 'string') {
      return `${counted(value.length, one, other)}, starting “${value.slice(0, PREVIEW_LENGTH).trim()}”`;
    }
    const names = Object.keys(value);
    if (names.length === 0) return 'nothing';
    const more =
      names.length > NAMED_AT_MOST ? `, and ${String(names.length - NAMED_AT_MOST)} more` : '';
    return `${counted(names.length, one, other)} (${names.slice(0, NAMED_AT_MOST).join(', ')}${more})`;
  };
}

export const REVERT_CONFLICT_LEAD =
  'Somebody saved the draft after you opened this tab. Reverting writes what is published over these parts of it; nothing has been merged.';

export const REVERT_KEEP_HINT = 'Reverts these parts to what is published, over their draft.';

export const REVERT_TAKE_HINT = 'Keeps their draft and drops this revert.';

// The pieces of a tab a revert would change that somebody else has since
// changed in the draft: what the draft holds now beside what the revert writes.
export function revertConflicts(view: ThemeView, tab: ScopedTab): Conflict[] {
  const now = baseBody(view);
  const reverted = revertRequest(view, tab);
  return TAB_PIECES[tab]
    .filter((piece) => JSON.stringify(now[piece]) !== JSON.stringify(reverted[piece]))
    .map((piece) => ({
      field: piece,
      label: PIECE_TITLES[piece],
      theirs: now[piece],
      yours: reverted[piece],
      secret: false,
      describe: describePiece(piece),
    }));
}

// The comparison a stale revert shows, and nothing before one has been refused.
export function shownRevertConflicts(stale: boolean, view: ThemeView, tab: ScopedTab): Conflict[] {
  return stale ? revertConflicts(view, tab) : [];
}

export function announceRevert(
  result: GatewayResult<unknown>,
  toast: (text: string) => void,
): void {
  if (result.ok) toast(REVERT_DONE);
}

export interface RevertWords {
  title: string;
  lead: string;
  label: string;
  conflict: { lead: string; keepHint: string; takeHint: string };
}

// The Revert panel's words, the button saying so while it runs.
export function revertWords(scope: ThemeScope, tab: ScopedTab, busy: boolean): RevertWords {
  return {
    title: REVERT_TITLE,
    lead: revertLead(scope, tab),
    label: busy ? REVERTING : REVERT_LABEL,
    conflict: {
      lead: REVERT_CONFLICT_LEAD,
      keepHint: REVERT_KEEP_HINT,
      takeHint: REVERT_TAKE_HINT,
    },
  };
}
