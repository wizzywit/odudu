import type { ThemeBodyRequest, ThemeBodyWire } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/service/capabilities';
import type { Conflict } from '#/shared/service/conflict';
import { isStale, writeFailureText } from '#/shared/service/failure';
import { andList, counted } from '#/shared/service/format';
import type { AdminCapability } from '#/shared/service/principal';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/service/result';
import {
  COLOURS_TITLE,
  IMAGES_TITLE,
  STYLESHEET_SECTION_TITLE,
  TEMPLATES_SECTION_TITLE,
  unsavedSections,
} from '#/features/branding/service/fields';
import type { ThemeScope } from '#/features/branding/service/scope';
import {
  BRANDING_TAB_SECTIONS,
  OFFERED_TABS,
  type BrandingTab,
  type OfferedTab,
  type ScopedTab,
} from '#/features/branding/service/tabs';
import { EMPTY_BODY, baseBody } from '#/features/branding/service/values';

export type ChangedPiece = ThemeView['changed'][number];

// The pieces the server compares, in the order their sections sit on the tabs.
const PIECE_TITLES: Readonly<Record<ChangedPiece, string>> = {
  tokens: COLOURS_TITLE,
  assets: IMAGES_TITLE,
  stylesheet: STYLESHEET_SECTION_TITLE,
  templates: TEMPLATES_SECTION_TITLE,
};

const PIECE_ORDER = Object.keys(PIECE_TITLES) as readonly ChangedPiece[];

// What each tab edits, which is what its revert takes back.
const TAB_PIECES: Readonly<Record<BrandingTab, readonly ChangedPiece[]>> = {
  theme: ['tokens', 'assets', 'stylesheet'],
  pages: ['templates'],
  mail: [],
  languages: [],
};

export function changedText(view: ThemeView): string | null {
  const titles = PIECE_ORDER.filter((piece) => view.changed.includes(piece)).map(
    (piece) => PIECE_TITLES[piece],
  );
  return titles.length === 0 ? null : `Changed: ${titles.join(', ')}`;
}

// The line under the bar's status: what is waiting, or that nothing is.
export function barText(view: ThemeView): string {
  if (view.draft === null) return 'No draft.';
  return changedText(view) ?? 'The draft matches what people see.';
}

// What is waiting as a count, for a bar with room for one line only; the
// sentence is what a title carries. Null when nothing is, and the sentence
// ("No draft.") is short enough as it is.
export function changeCount(view: ThemeView): string | null {
  return view.draft === null || view.changed.length === 0
    ? null
    : counted(view.changed.length, 'change', 'changes');
}

// The line a bar with room for a few words says: how many changes wait, or
// that there is no draft or nothing to publish.
export function changeBrief(view: ThemeView): string {
  if (view.draft === null) return 'No draft';
  return changeCount(view) ?? 'Up to date';
}

// The tag's word where the bar has no room for the sentence.
export function publishedShort(view: ThemeView): string {
  return view.published === null ? 'Not live' : 'Live';
}

// The tabs holding part of what would change at a publish.
export function tabsChanged(changed: ThemeView['changed']): ReadonlySet<OfferedTab> {
  return new Set(
    OFFERED_TABS.filter((tab) => TAB_PIECES[tab].some((piece) => changed.includes(piece))),
  );
}

// On a narrow screen the bar keeps Publish and folds what else it does into
// a menu of this name.
export const MORE_TRIGGER = 'More';

export const MORE_LABEL = 'More publishing actions';

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
  return `Save your changes first, in ${andList(sections.map((title) => `“${title}”`))}: reverting works on the saved draft.`;
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

const PIECE_OF: Readonly<Record<ChangedPiece, (body: ThemeBodyWire) => Partial<ThemeBodyWire>>> = {
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

export const DISCARD_LABEL = 'Discard draft…';

export const DISCARD_TITLE = 'Discard the draft?';

export const DISCARD_CONFIRM = 'Discard draft';

export const DISCARD_DONE = 'Draft discarded';

export const DISCARD_BODY_TENANT =
  'Deletes the saved draft and nothing else: what is published stays, and people keep seeing it. Unlike Reset to default, nothing is unpublished.';

export const DISCARD_BODY_CLIENT =
  'Deletes the client’s saved draft and nothing else: what is published for the client stays, and people keep seeing it. Unlike Reset to default, nothing is unpublished.';

export function discardBody(scope: ThemeScope): string {
  return scope.kind === 'tenant' ? DISCARD_BODY_TENANT : DISCARD_BODY_CLIENT;
}

export function discardFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The draft',
    verb: 'discarded',
    lookAt: 'the status above',
    stale:
      'Somebody saved the draft after you opened it. The page now shows their version: look it over, then discard it if you still want to.',
  });
}

// What a scope's writes need: a client's theme is its own client's to change.
export function writeCapability(scope: ThemeScope): AdminCapability {
  return scope.kind === 'tenant' ? 'manage-tenant' : 'manage-clients';
}

// What a refused section save says of a 403, naming the capability of the scope.
export function themeRefusal(scope: ThemeScope): (problem: Problem) => string | null {
  return (problem) => writeRefusal(problem, writeCapability(scope));
}
